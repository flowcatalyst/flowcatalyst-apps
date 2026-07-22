package io.flowcatalyst.fulfilgo.execution.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import io.flowcatalyst.fulfilgo.execution.App
import io.flowcatalyst.fulfilgo.execution.telemetry.TelemetryService
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(onDriverLogin: () -> Unit) {
    val context = LocalContext.current
    val container = (context.applicationContext as App).container
    val scope = rememberCoroutineScope()

    val signedIn by container.driverSignedIn.collectAsState()
    val driver by container.driver.collectAsState()
    val tracking by container.prefs.trackingEnabled.collectAsState(initial = false)
    val dead by container.outbox.dead.collectAsState(initial = emptyList())

    val storedClientId by container.prefs.clientId.collectAsState(initial = "")
    val storedDepotRef by container.prefs.depotRef.collectAsState(initial = "")
    val storedBaseUrl by container.prefs.baseUrl.collectAsState(initial = "")

    var clientId by rememberSaveable { mutableStateOf<String?>(null) }
    var depotRef by rememberSaveable { mutableStateOf<String?>(null) }
    var baseUrl by rememberSaveable { mutableStateOf<String?>(null) }
    var telemetryError by remember { mutableStateOf<String?>(null) }
    var platformSignedIn by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { platformSignedIn = container.platformSession.isAuthenticated() }

    val requestPermissions = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        if (grants[Manifest.permission.ACCESS_FINE_LOCATION] == true) {
            scope.launch {
                container.prefs.setTracking(true)
                TelemetryService.start(context)
            }
        } else {
            telemetryError = "Location permission is required to share your position."
        }
    }

    fun toggleTracking(enable: Boolean) {
        telemetryError = null
        scope.launch {
            if (!enable) {
                container.prefs.setTracking(false)
                TelemetryService.stop(context)
                return@launch
            }
            if (!container.platformSession.isAuthenticated()) {
                telemetryError = "Sign in to the platform (below) before starting telemetry."
                return@launch
            }
            val needed = buildList {
                add(Manifest.permission.ACCESS_FINE_LOCATION)
                if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
            }.filter {
                ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
            }
            if (needed.isNotEmpty()) {
                requestPermissions.launch(needed.toTypedArray())
            } else {
                container.prefs.setTracking(true)
                TelemetryService.start(context)
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        // Device → depot binding (the picking app's station pattern): an
        // admin binds the device once; drivers sign in per shift.
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Driver station", style = MaterialTheme.typography.titleMedium)
            Text(
                "Bind this device to a client + home depot (from Transport → Depots in " +
                    "management). Drivers then sign in with their staff code + PIN.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = clientId ?: storedClientId,
                onValueChange = { clientId = it },
                label = { Text("Client id") },
                placeholder = { Text("clt_…") },
                enabled = !signedIn,
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = depotRef ?: storedDepotRef,
                onValueChange = { depotRef = it },
                label = { Text("Depot ref") },
                placeholder = { Text("dep-bloemfontein") },
                enabled = !signedIn,
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = baseUrl ?: storedBaseUrl,
                onValueChange = { baseUrl = it },
                label = { Text("Server URL") },
                placeholder = { Text("http://10.0.2.2:3200") },
                enabled = !signedIn,
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            if (!signedIn && (clientId != null || depotRef != null || baseUrl != null)) {
                Button(
                    onClick = {
                        scope.launch {
                            container.prefs.setStation(
                                clientId ?: storedClientId,
                                depotRef ?: storedDepotRef,
                                baseUrl ?: storedBaseUrl,
                            )
                            clientId = null
                            depotRef = null
                            baseUrl = null
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Save station") }
            }
            if (signedIn) {
                Text(
                    buildString {
                        append("Signed in: ${driver?.displayName ?: "Driver"}")
                        driver?.defaultVehicleReg?.let { append(" · $it") }
                    },
                    style = MaterialTheme.typography.bodyMedium,
                )
                FilledTonalButton(
                    onClick = { scope.launch { container.exitDriver() } },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("End shift (sign out driver)") }
            } else {
                FilledTonalButton(
                    onClick = onDriverLogin,
                    enabled = storedClientId.isNotEmpty() && storedDepotRef.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Driver sign in") }
            }
        }

        // Telemetry — the native foreground-service tracker.
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Telemetry", style = MaterialTheme.typography.titleMedium)
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Share location while on duty", style = MaterialTheme.typography.bodyMedium)
                Switch(checked = tracking, onCheckedChange = { toggleTracking(it) })
            }
            telemetryError?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
        }

        // Platform account (OIDC/PKCE) — telemetry auths on this plane.
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Platform account", style = MaterialTheme.typography.titleMedium)
            if (platformSignedIn) {
                OutlinedButton(
                    onClick = {
                        scope.launch {
                            container.platformSession.signOut()
                            platformSignedIn = false
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Sign out") }
            } else {
                Button(
                    onClick = {
                        scope.launch {
                            telemetryError = null
                            try {
                                container.platformAuth.login(context)
                                platformSignedIn = true
                            } catch (err: Exception) {
                                telemetryError = err.message ?: err.toString()
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Platform sign in") }
            }
        }

        // Dead-lettered offline changes — a human decides.
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Failed changes", style = MaterialTheme.typography.titleMedium)
            if (dead.isEmpty()) {
                Text(
                    "Nothing needs attention.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            for (item in dead) {
                Card {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            "${item.method} ${item.endpoint}",
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = FontFamily.Monospace,
                        )
                        item.lastError?.let {
                            Text(
                                it,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(onClick = { scope.launch { container.outbox.retryDead(item.id) } }) {
                                Text("Retry")
                            }
                            TextButton(onClick = { scope.launch { container.outbox.discardDead(item.id) } }) {
                                Text("Discard")
                            }
                        }
                    }
                }
            }
        }
    }
}
