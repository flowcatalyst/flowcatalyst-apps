package io.flowcatalyst.fulfilgo.execution.core

import io.flowcatalyst.fulfilgo.execution.api.AppJson
import io.flowcatalyst.fulfilgo.execution.api.LoginErrorBody
import io.flowcatalyst.fulfilgo.execution.api.MobileTokenResponse
import io.flowcatalyst.fulfilgo.execution.api.PickerTokenResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

/** Refresh this far before expiry (driver access TTL defaults to 15 min). */
private const val EXPIRY_SKEW_MS = 60_000L

private val JSON_MEDIA = "application/json".toMediaType()

class DriverLoginException(val status: Int, val code: String, message: String) :
    Exception(message)

/**
 * Driver session — port of mobile-kit's picker-session on the driver-auth
 * base path: fulfilgo-issued HS256 tokens, staff code + PIN acquisition,
 * single-flight refresh, depot-bound.
 */
class DriverSession(
    private val store: TokenStore,
    private val http: OkHttpClient,
    private val baseUrl: suspend () -> String,
    private val clientId: suspend () -> String?,
    private val onSignedOut: () -> Unit = {},
) : TokenProvider {
    private val refreshMutex = Mutex()

    suspend fun loginPin(depotRef: String, staffCode: String, pin: String) {
        val client = clientId() ?: throw DriverLoginException(0, "NO_STATION", "Device not bound to a client.")
        val body = buildJsonObject {
            put("depotRef", depotRef)
            put("staffCode", staffCode)
            put("pin", pin)
        }
        val res = post("${baseUrl()}/clients/$client/driver-auth/login/pin", body.toString())
        if (res.first !in 200..299) {
            val err = runCatching { AppJson.decodeFromString<LoginErrorBody>(res.second) }.getOrNull()
            throw DriverLoginException(
                res.first,
                err?.code ?: "LOGIN_FAILED",
                err?.message ?: "Login failed (${res.first}).",
            )
        }
        persist(AppJson.decodeFromString<PickerTokenResponse>(res.second))
    }

    suspend fun isAuthenticated(): Boolean = store.load()?.refreshToken != null

    suspend fun signOut() {
        store.clear()
        onSignedOut()
    }

    override suspend fun getAccessToken(): String? {
        val current = store.load() ?: return null
        if (current.expiresAt - EXPIRY_SKEW_MS > System.currentTimeMillis()) return current.accessToken
        if (!refresh()) return null
        return store.load()?.accessToken
    }

    override suspend fun refresh(): Boolean = refreshMutex.withLock { doRefresh() }

    private suspend fun doRefresh(): Boolean {
        val current = store.load()
        val client = clientId()
        val refreshToken = current?.refreshToken
        if (refreshToken == null || client == null) return false
        val body = buildJsonObject { put("refreshToken", refreshToken) }
        val res = try {
            post("${baseUrl()}/clients/$client/driver-auth/refresh", body.toString())
        } catch (_: IOException) {
            return false // network failure — keep tokens, caller retries later
        }
        if (res.first !in 200..299) {
            if (res.first == 401) {
                // Invalid/expired token, or the driver was suspended/moved depot.
                store.clear()
                onSignedOut()
            }
            return false
        }
        persist(AppJson.decodeFromString<PickerTokenResponse>(res.second))
        return true
    }

    private suspend fun persist(tokens: PickerTokenResponse) {
        store.save(
            StoredTokens(
                accessToken = tokens.accessToken,
                refreshToken = tokens.refreshToken,
                expiresAt = System.currentTimeMillis() + tokens.expiresIn * 1000,
            ),
        )
    }

    private suspend fun post(url: String, body: String): Pair<Int, String> =
        withContext(Dispatchers.IO) {
            val req = Request.Builder().url(url).post(body.toRequestBody(JSON_MEDIA)).build()
            http.newCall(req).execute().use { it.code to (it.body?.string() ?: "") }
        }
}

/**
 * Platform OIDC session (PKCE-brokered via the /auth/mobile routes). Only
 * telemetry and platform sign-out need it — driver work rides the driver
 * session.
 */
class PlatformSession(
    private val store: TokenStore,
    private val http: OkHttpClient,
    private val baseUrl: suspend () -> String,
) : TokenProvider {
    private val refreshMutex = Mutex()

    suspend fun setTokens(tokens: MobileTokenResponse) {
        val prior = store.load()
        store.save(
            StoredTokens(
                accessToken = tokens.accessToken,
                // Rotation may omit the refresh token — keep the prior one.
                refreshToken = tokens.refreshToken ?: prior?.refreshToken,
                expiresAt = tokens.expiresAt,
            ),
        )
    }

    suspend fun tokensNow(): StoredTokens? = store.load()

    suspend fun signOut() = store.clear()

    suspend fun isAuthenticated(): Boolean = store.load() != null

    override suspend fun getAccessToken(): String? {
        val current = store.load() ?: return null
        if (current.expiresAt - EXPIRY_SKEW_MS > System.currentTimeMillis()) return current.accessToken
        if (!refresh()) return null
        return store.load()?.accessToken
    }

    override suspend fun refresh(): Boolean = refreshMutex.withLock {
        val refreshToken = store.load()?.refreshToken ?: return false
        val body = buildJsonObject {
            put("app", "execution")
            put("refreshToken", refreshToken)
        }
        val res = try {
            withContext(Dispatchers.IO) {
                val req = Request.Builder()
                    .url("${baseUrl()}/auth/mobile/refresh")
                    .post(body.toString().toRequestBody(JSON_MEDIA))
                    .build()
                http.newCall(req).execute().use { it.code to (it.body?.string() ?: "") }
            }
        } catch (_: IOException) {
            return false
        }
        if (res.first !in 200..299) {
            if (res.first == 401) store.clear()
            return false
        }
        setTokens(AppJson.decodeFromString<MobileTokenResponse>(res.second))
        return true
    }
}

/**
 * Auth priority (mirror of the Vue context): a signed-in DRIVER wins —
 * transport endpoints authorize on the driver session's depot attributes;
 * otherwise the platform OIDC session.
 */
class CombinedTokenProvider(
    private val driver: DriverSession,
    private val platform: PlatformSession,
) : TokenProvider {
    override suspend fun getAccessToken(): String? =
        driver.getAccessToken() ?: platform.getAccessToken()

    override suspend fun refresh(): Boolean =
        if (driver.isAuthenticated()) driver.refresh() else platform.refresh()
}
