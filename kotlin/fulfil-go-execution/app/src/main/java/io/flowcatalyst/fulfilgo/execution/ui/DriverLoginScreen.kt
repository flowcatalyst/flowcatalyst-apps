package io.flowcatalyst.fulfilgo.execution.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import io.flowcatalyst.fulfilgo.execution.App
import kotlinx.coroutines.launch

/**
 * Driver shift sign-in — staff code + PIN at the device's bound depot (the
 * picking app's pattern). The depot binding itself lives on Settings.
 */
@Composable
fun DriverLoginScreen(onSignedIn: () -> Unit, onSettings: () -> Unit) {
    val container = (LocalContext.current.applicationContext as App).container
    val scope = rememberCoroutineScope()
    val depotRef by container.prefs.depotRef.collectAsState(initial = "")
    val clientId by container.prefs.clientId.collectAsState(initial = "")

    var staffCode by rememberSaveable { mutableStateOf("") }
    var pin by rememberSaveable { mutableStateOf("") }
    var busy by rememberSaveable { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) {
        Text("FulfilGo Drive", style = MaterialTheme.typography.headlineSmall)
        Text(
            "Depot ${depotRef.ifEmpty { "not set" }}",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        if (clientId.isNotEmpty() && depotRef.isNotEmpty()) {
            OutlinedTextField(
                value = staffCode,
                onValueChange = { staffCode = it },
                label = { Text("Staff code") },
                placeholder = { Text("D01") },
                singleLine = true,
                modifier = Modifier
                    .widthIn(max = 360.dp)
                    .fillMaxWidth(),
            )
            OutlinedTextField(
                value = pin,
                onValueChange = { pin = it },
                label = { Text("PIN") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                modifier = Modifier
                    .widthIn(max = 360.dp)
                    .fillMaxWidth(),
            )
            Button(
                onClick = {
                    scope.launch {
                        busy = true
                        error = null
                        try {
                            container.driverSession.loginPin(depotRef, staffCode.trim(), pin)
                            container.startDriverShift()
                            staffCode = ""
                            pin = ""
                            onSignedIn()
                        } catch (err: Exception) {
                            error = err.message ?: err.toString()
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = !busy && staffCode.isNotBlank() && pin.isNotBlank(),
                modifier = Modifier
                    .widthIn(max = 360.dp)
                    .fillMaxWidth(),
            ) { Text("Sign in") }
        } else {
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.tertiaryContainer,
                ),
            ) {
                Text(
                    "This device is not bound to a depot yet — set the client + depot in Settings.",
                    modifier = Modifier.padding(16.dp),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }

        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        TextButton(onClick = onSettings) { Text("Configure device") }
    }
}
