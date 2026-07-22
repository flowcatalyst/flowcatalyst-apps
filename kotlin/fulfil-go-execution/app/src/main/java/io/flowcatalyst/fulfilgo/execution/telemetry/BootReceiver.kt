package io.flowcatalyst.fulfilgo.execution.telemetry

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import io.flowcatalyst.fulfilgo.execution.core.Prefs

/**
 * Resume on-duty tracking after a reboot (Transistorsoft startOnBoot
 * parity). Android 14+ only allows a location FGS from boot when background
 * location ("Allow all the time") is granted — otherwise tracking resumes
 * the next time the driver opens the app.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        if (!Prefs(context).trackingEnabledBlocking()) return
        val backgroundGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_BACKGROUND_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        if (!backgroundGranted) return
        runCatching { TelemetryService.start(context) }
    }
}
