package io.flowcatalyst.fulfilgo.execution

import android.app.Application
import io.flowcatalyst.fulfilgo.execution.api.DriverMe
import io.flowcatalyst.fulfilgo.execution.api.TransportApi
import io.flowcatalyst.fulfilgo.execution.auth.PlatformAuth
import io.flowcatalyst.fulfilgo.execution.core.ApiClient
import io.flowcatalyst.fulfilgo.execution.core.CombinedTokenProvider
import io.flowcatalyst.fulfilgo.execution.core.DriverSession
import io.flowcatalyst.fulfilgo.execution.core.PlatformSession
import io.flowcatalyst.fulfilgo.execution.core.Prefs
import io.flowcatalyst.fulfilgo.execution.core.SseClient
import io.flowcatalyst.fulfilgo.execution.core.TokenStore
import io.flowcatalyst.fulfilgo.execution.core.networkRegained
import io.flowcatalyst.fulfilgo.execution.db.AppDb
import io.flowcatalyst.fulfilgo.execution.outbox.OutboxQueue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * Application-scoped wiring — the native mirror of the Vue app's
 * createAppCtx(): sessions, api client, outbox, telemetry auth, and the
 * driver-shift state both tabs share.
 */
class AppContainer(app: Application) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val prefs = Prefs(app)
    val db = AppDb.get(app)

    private val baseUrl: suspend () -> String = { prefs.baseUrlNow() }

    private val _driverSignedIn = MutableStateFlow(false)
    val driverSignedIn: StateFlow<Boolean> = _driverSignedIn
    private val _driver = MutableStateFlow<DriverMe?>(null)
    val driver: StateFlow<DriverMe?> = _driver

    val platformSession = PlatformSession(
        store = TokenStore(app, "platform"),
        http = okhttp3.OkHttpClient(),
        baseUrl = baseUrl,
    )

    val driverSession = DriverSession(
        store = TokenStore(app, "driver"),
        http = okhttp3.OkHttpClient(),
        baseUrl = baseUrl,
        clientId = { prefs.clientIdNow().ifEmpty { null } },
        onSignedOut = {
            _driverSignedIn.value = false
            _driver.value = null
        },
    )

    val api = ApiClient(
        baseUrlProvider = baseUrl,
        tokens = CombinedTokenProvider(driverSession, platformSession),
    )

    val transport = TransportApi(api)
    val outbox = OutboxQueue(db.outbox(), api, scope)

    val platformAuth = PlatformAuth(
        http = api.http,
        baseUrl = baseUrl,
        session = platformSession,
    )

    val sse = SseClient(
        http = api.http,
        url = baseUrl,
        headers = { api.authHeaders() },
        scope = scope,
    )

    /** After driver login (or app start with a live session): load identity. */
    suspend fun startDriverShift() {
        val me = transport.driverMe(prefs.clientIdNow())
        _driver.value = me
        _driverSignedIn.value = true
    }

    /** Driver sign-out (End shift) — the station binding survives. */
    suspend fun exitDriver() {
        driverSession.signOut()
    }

    fun start(app: Application) {
        scope.launch {
            networkRegained(app).collect {
                outbox.flush()
                sse.reconnectNow()
            }
        }
        scope.launch {
            // The stream authorizes per-principal — follow the driver shift.
            driverSignedIn.collect { if (it) sse.connect() else sse.disconnect() }
        }
        scope.launch {
            // App start with a live driver session: restore the shift.
            if (driverSession.isAuthenticated()) {
                runCatching { startDriverShift() }
            }
        }
    }
}

class App : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        container.start(this)
    }
}
