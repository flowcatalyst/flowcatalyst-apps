package io.flowcatalyst.fulfilgo.execution.core

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import io.flowcatalyst.fulfilgo.execution.BuildConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking

private val Context.dataStore by preferencesDataStore(name = "fulfilgo_exec")

/**
 * Device-level settings — the driver station binding (the manual placeholder
 * for device enrollment: clientId + home depot; drivers come and go per
 * shift), the server base URL, and the on-duty tracking flag the boot
 * receiver consults.
 */
class Prefs(private val context: Context) {
    private val keyClientId = stringPreferencesKey("station.clientId")
    private val keyDepotRef = stringPreferencesKey("station.depotRef")
    private val keyBaseUrl = stringPreferencesKey("station.baseUrl")
    private val keyTracking = booleanPreferencesKey("telemetry.tracking")

    val clientId: Flow<String> = context.dataStore.data.map { it[keyClientId] ?: "" }
    val depotRef: Flow<String> = context.dataStore.data.map { it[keyDepotRef] ?: "" }
    val baseUrl: Flow<String> =
        context.dataStore.data.map { it[keyBaseUrl] ?: BuildConfig.DEFAULT_API_BASE_URL }
    val trackingEnabled: Flow<Boolean> = context.dataStore.data.map { it[keyTracking] ?: false }

    suspend fun setStation(clientId: String, depotRef: String, baseUrl: String) {
        context.dataStore.edit {
            it[keyClientId] = clientId.trim()
            it[keyDepotRef] = depotRef.trim()
            it[keyBaseUrl] = baseUrl.trim().trimEnd('/')
        }
    }

    suspend fun setTracking(enabled: Boolean) {
        context.dataStore.edit { it[keyTracking] = enabled }
    }

    suspend fun clientIdNow(): String = clientId.first()
    suspend fun depotRefNow(): String = depotRef.first()
    suspend fun baseUrlNow(): String = baseUrl.first()

    /** Boot receiver only — no coroutine scope exists there yet. */
    fun trackingEnabledBlocking(): Boolean = runBlocking { trackingEnabled.first() }

    // ── Offline overlays (the Vue app's localStorage maps, JSON-encoded) ──

    private val keyScanned = stringPreferencesKey("overlay.scanned")
    private val keyPending = stringPreferencesKey("overlay.pending")
    private val keyArrived = stringPreferencesKey("overlay.arrived")

    suspend fun loadOverlay(which: OverlayKind): String =
        context.dataStore.data.first()[keyFor(which)] ?: "{}"

    suspend fun saveOverlay(which: OverlayKind, json: String) {
        context.dataStore.edit { it[keyFor(which)] = json }
    }

    private fun keyFor(which: OverlayKind) = when (which) {
        OverlayKind.SCANNED -> keyScanned
        OverlayKind.PENDING -> keyPending
        OverlayKind.ARRIVED -> keyArrived
    }
}

enum class OverlayKind { SCANNED, PENDING, ARRIVED }
