package io.flowcatalyst.fulfilgo.execution.auth

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import io.flowcatalyst.fulfilgo.execution.api.AppJson
import io.flowcatalyst.fulfilgo.execution.api.AuthorizeUrlResponse
import io.flowcatalyst.fulfilgo.execution.api.MobileTokenResponse
import io.flowcatalyst.fulfilgo.execution.core.PlatformSession
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.security.MessageDigest
import java.security.SecureRandom
import android.util.Base64 as AndroidBase64

const val REDIRECT_URI = "fulfilgo-exec://auth/callback"
private const val LOGIN_TIMEOUT_MS = 5 * 60_000L

private fun base64Url(bytes: ByteArray): String =
    AndroidBase64.encodeToString(
        bytes,
        AndroidBase64.URL_SAFE or AndroidBase64.NO_PADDING or AndroidBase64.NO_WRAP,
    )

/**
 * PKCE login round trip — port of mobile-kit's auth-client: server-brokered
 * authorize URL → Custom Tab → deep-link callback (MainActivity hands the
 * URI to [onCallback]) → code exchange → tokens into the platform session.
 */
class PlatformAuth(
    private val http: OkHttpClient,
    private val baseUrl: suspend () -> String,
    private val session: PlatformSession,
) {
    private var pending: CompletableDeferred<Uri>? = null

    /** MainActivity calls this for every fulfilgo-exec:// VIEW intent. */
    fun onCallback(uri: Uri) {
        if (uri.toString().startsWith(REDIRECT_URI)) pending?.complete(uri)
    }

    suspend fun login(context: Context) {
        val random = SecureRandom()
        val verifierBytes = ByteArray(32).also(random::nextBytes)
        val verifier = base64Url(verifierBytes)
        val challenge = base64Url(
            MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)),
        )
        val state = base64Url(ByteArray(16).also(random::nextBytes))

        val authorize = post(
            "/auth/mobile/authorize-url",
            buildJsonObject {
                put("app", "execution")
                put("codeChallenge", challenge)
                put("redirectUri", REDIRECT_URI)
                put("state", state)
            }.toString(),
        )
        val url = AppJson.decodeFromString<AuthorizeUrlResponse>(authorize).url

        val deferred = CompletableDeferred<Uri>()
        pending = deferred
        try {
            CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(url))
            val callback = withTimeout(LOGIN_TIMEOUT_MS) { deferred.await() }

            if (callback.getQueryParameter("state") != state) {
                throw IllegalStateException("login callback state mismatch — possible CSRF, aborting")
            }
            val code = callback.getQueryParameter("code")
                ?: throw IllegalStateException(
                    "login was rejected: ${callback.getQueryParameter("error") ?: "missing code"}",
                )

            val tokenBody = post(
                "/auth/mobile/token",
                buildJsonObject {
                    put("app", "execution")
                    put("code", code)
                    put("codeVerifier", verifier)
                    put("redirectUri", REDIRECT_URI)
                }.toString(),
            )
            session.setTokens(AppJson.decodeFromString<MobileTokenResponse>(tokenBody))
        } finally {
            pending = null
        }
    }

    private suspend fun post(path: String, body: String): String = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("${baseUrl()}$path")
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        http.newCall(req).execute().use { res ->
            val text = res.body?.string() ?: ""
            check(res.code in 200..299) { "auth $path failed (${res.code}): ${text.take(300)}" }
            text
        }
    }
}
