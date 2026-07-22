package io.flowcatalyst.fulfilgo.execution.telemetry

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import io.flowcatalyst.fulfilgo.execution.App
import io.flowcatalyst.fulfilgo.execution.MainActivity
import io.flowcatalyst.fulfilgo.execution.R
import io.flowcatalyst.fulfilgo.execution.db.TelemetryFix
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.time.Instant
import java.util.UUID

private const val CHANNEL_ID = "tracking"
private const val NOTIFICATION_ID = 1001
private const val UPLOAD_BATCH = 50
private const val UPLOAD_INTERVAL_MS = 30_000L

/**
 * On-duty telemetry — the native replacement for the Transistorsoft
 * uploader: a location foreground service records fixes into Room (the
 * offline buffer) and a drain loop batch-POSTs them to
 * `/telemetry/locations` in the Transistorsoft wire shape the server
 * already ingests. Fixes are only deleted on a 2xx, so nothing is lost
 * offline; auth is the platform OIDC session with native refresh.
 */
class TelemetryService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var callback: LocationCallback? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundWithType()
        startLocationUpdates()
        startUploadLoop()
        return START_STICKY
    }

    private fun startForegroundWithType() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "On-duty tracking",
                NotificationManager.IMPORTANCE_LOW,
            ),
        )
        val tapIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_tracking)
            .setContentTitle("FulfilGo Drive")
            .setContentText("Sharing location while on duty")
            .setOngoing(true)
            .setContentIntent(tapIntent)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun startLocationUpdates() {
        if (callback != null) return
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) {
            stopSelf()
            return
        }
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 15_000L)
            // Battery-conscious parity with the Transistorsoft distanceFilter: 25.
            .setMinUpdateDistanceMeters(25f)
            .build()
        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val app = application as App
                for (location in result.locations) {
                    val battery = batterySnapshot()
                    val fix = TelemetryFix(
                        uuid = UUID.randomUUID().toString(),
                        timestamp = Instant.ofEpochMilli(location.time).toString(),
                        latitude = location.latitude,
                        longitude = location.longitude,
                        accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else null,
                        speed = if (location.hasSpeed()) location.speed.toDouble() else null,
                        heading = if (location.hasBearing()) location.bearing.toDouble() else null,
                        altitude = if (location.hasAltitude()) location.altitude else null,
                        isMoving = if (location.hasSpeed()) location.speed > 0.5f else null,
                        batteryLevel = battery.first,
                        batteryCharging = battery.second,
                        createdAt = System.currentTimeMillis(),
                    )
                    scope.launch { app.container.db.telemetry().insert(fix) }
                }
            }
        }
        callback = cb
        LocationServices.getFusedLocationProviderClient(this)
            .requestLocationUpdates(request, cb, Looper.getMainLooper())
    }

    private fun batterySnapshot(): Pair<Double?, Boolean?> {
        val bm = getSystemService(Context.BATTERY_SERVICE) as? BatteryManager ?: return null to null
        val pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val level = if (pct in 0..100) pct / 100.0 else null
        return level to bm.isCharging
    }

    private fun startUploadLoop() {
        scope.launch {
            val app = application as App
            while (true) {
                try {
                    drain(app)
                } catch (_: IOException) {
                    // Offline — fixes stay buffered in Room; next pass retries.
                } catch (_: Exception) {
                    // Never let the drain loop die while on duty.
                }
                delay(UPLOAD_INTERVAL_MS)
            }
        }
    }

    private suspend fun drain(app: App) {
        val dao = app.container.db.telemetry()
        while (true) {
            val batch = dao.oldest(UPLOAD_BATCH)
            if (batch.isEmpty()) return
            val token = app.container.platformSession.getAccessToken() ?: return
            val body = buildJsonObject {
                put(
                    "location",
                    buildJsonArray {
                        for (fix in batch) {
                            add(
                                buildJsonObject {
                                    put("uuid", fix.uuid)
                                    put("timestamp", fix.timestamp)
                                    put(
                                        "coords",
                                        buildJsonObject {
                                            put("latitude", fix.latitude)
                                            put("longitude", fix.longitude)
                                            fix.accuracy?.let { put("accuracy", it) }
                                            fix.speed?.let { put("speed", it) }
                                            fix.heading?.let { put("heading", it) }
                                            fix.altitude?.let { put("altitude", it) }
                                        },
                                    )
                                    fix.isMoving?.let { put("is_moving", it) }
                                    if (fix.batteryLevel != null || fix.batteryCharging != null) {
                                        put(
                                            "battery",
                                            buildJsonObject {
                                                fix.batteryLevel?.let { put("level", it) }
                                                fix.batteryCharging?.let { put("is_charging", it) }
                                            },
                                        )
                                    }
                                },
                            )
                        }
                    },
                )
            }
            val req = Request.Builder()
                .url("${app.container.api.baseUrl()}/telemetry/locations")
                .header("authorization", "Bearer $token")
                .post(body.toString().toRequestBody("application/json".toMediaType()))
                .build()
            val status = withContext(Dispatchers.IO) {
                app.container.api.http.newCall(req).execute().use { it.code }
            }
            when {
                status in 200..299 -> dao.delete(batch)
                status == 401 -> {
                    if (!app.container.platformSession.refresh()) return
                }
                else -> return // server trouble — keep the batch, retry next pass
            }
        }
    }

    override fun onDestroy() {
        callback?.let {
            LocationServices.getFusedLocationProviderClient(this).removeLocationUpdates(it)
        }
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        fun start(context: Context) {
            context.startForegroundService(Intent(context, TelemetryService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, TelemetryService::class.java))
        }
    }
}
