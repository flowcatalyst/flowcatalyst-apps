package io.flowcatalyst.fulfilgo.execution

import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import io.flowcatalyst.fulfilgo.execution.ui.DriverLoginScreen
import io.flowcatalyst.fulfilgo.execution.ui.SettingsScreen
import io.flowcatalyst.fulfilgo.execution.ui.work.WorkScreen
import io.flowcatalyst.fulfilgo.execution.ui.work.WorkViewModel

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleDeepLink(intent)

        setContent {
            // Stock Material 3 — dynamic color on 12+, default schemes below.
            val dark = isSystemInDarkTheme()
            val context = LocalContext.current
            val colorScheme = when {
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
                    if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
                dark -> darkColorScheme()
                else -> lightColorScheme()
            }

            MaterialTheme(colorScheme = colorScheme) {
                val navController = rememberNavController()
                val backStack by navController.currentBackStackEntryAsState()
                val route = backStack?.destination?.route

                Scaffold(
                    bottomBar = {
                        NavigationBar {
                            NavigationBarItem(
                                selected = route == "work" || route == "driver-login",
                                onClick = {
                                    navController.navigate("work") {
                                        popUpTo("work") { inclusive = true }
                                    }
                                },
                                icon = { Icon(Icons.Filled.LocalShipping, contentDescription = null) },
                                label = { Text("Work") },
                            )
                            NavigationBarItem(
                                selected = route == "settings",
                                onClick = {
                                    navController.navigate("settings") { popUpTo("work") }
                                },
                                icon = { Icon(Icons.Filled.Settings, contentDescription = null) },
                                label = { Text("Settings") },
                            )
                        }
                    },
                ) { padding ->
                    NavHost(
                        navController = navController,
                        startDestination = "work",
                        modifier = Modifier.padding(padding),
                    ) {
                        composable("work") {
                            val vm: WorkViewModel = viewModel()
                            WorkScreen(vm, onDriverLogin = { navController.navigate("driver-login") })
                        }
                        composable("driver-login") {
                            DriverLoginScreen(
                                onSignedIn = {
                                    navController.navigate("work") {
                                        popUpTo("work") { inclusive = true }
                                    }
                                },
                                onSettings = { navController.navigate("settings") },
                            )
                        }
                        composable("settings") {
                            SettingsScreen(onDriverLogin = { navController.navigate("driver-login") })
                        }
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLink(intent)
    }

    /** OIDC callback (fulfilgo-exec://auth/callback) → the pending PKCE login. */
    private fun handleDeepLink(intent: Intent?) {
        val uri = intent?.data ?: return
        (application as App).container.platformAuth.onCallback(uri)
    }
}
