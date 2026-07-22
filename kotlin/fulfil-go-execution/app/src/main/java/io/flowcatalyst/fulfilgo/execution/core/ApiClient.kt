package io.flowcatalyst.fulfilgo.execution.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Same surface as mobile-kit's TokenProvider. */
interface TokenProvider {
    /** Current access token, refreshing first if it's about to expire. Null = signed out. */
    suspend fun getAccessToken(): String?

    /** Force a refresh-token exchange. False = refresh failed (signed out). */
    suspend fun refresh(): Boolean
}

class ApiHttpException(val status: Int, val bodyText: String, path: String) :
    Exception("API $path failed ($status): ${bodyText.take(300)}")

data class ApiResponse(val status: Int, val bodyText: String) {
    val ok: Boolean get() = status in 200..299
}

/**
 * Thin OkHttp wrapper — port of mobile-kit's api-client: base-URL joining,
 * bearer injection, one refresh-and-retry on 401. IOException propagates to
 * callers, which is the "offline → hand to the outbox" signal.
 */
class ApiClient(
    private val baseUrlProvider: suspend () -> String,
    private val tokens: TokenProvider,
) {
    private val jsonMedia = "application/json".toMediaType()
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    suspend fun baseUrl(): String = baseUrlProvider().trimEnd('/')

    suspend fun authHeaders(): Map<String, String> {
        val token = tokens.getAccessToken() ?: return emptyMap()
        return mapOf("authorization" to "Bearer $token")
    }

    private suspend fun doFetch(
        path: String,
        method: String,
        jsonBody: String?,
        headers: Map<String, String>,
    ): ApiResponse = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url("${baseUrl()}$path")
        for ((k, v) in authHeaders()) builder.header(k, v)
        for ((k, v) in headers) builder.header(k, v)
        val body = jsonBody?.toRequestBody(jsonMedia)
        builder.method(method, body)
        http.newCall(builder.build()).execute().use { res ->
            ApiResponse(res.code, res.body?.string() ?: "")
        }
    }

    /**
     * @throws IOException on network failure (the offline signal)
     */
    suspend fun request(
        path: String,
        method: String = "GET",
        jsonBody: String? = null,
        headers: Map<String, String> = emptyMap(),
    ): ApiResponse {
        val res = doFetch(path, method, jsonBody, headers)
        if (res.status == 401 && tokens.refresh()) {
            return doFetch(path, method, jsonBody, headers)
        }
        return res
    }

    /** ok-or-throw variant of request(); ApiHttpException carries the status. */
    suspend fun json(
        path: String,
        method: String = "GET",
        jsonBody: String? = null,
    ): String {
        val res = request(path, method, jsonBody)
        if (!res.ok) throw ApiHttpException(res.status, res.bodyText, path)
        return res.bodyText
    }
}
