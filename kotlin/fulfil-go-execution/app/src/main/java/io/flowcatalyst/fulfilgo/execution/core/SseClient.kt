package io.flowcatalyst.fulfilgo.execution.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit
import kotlin.random.Random

enum class SseState { CLOSED, CONNECTING, OPEN, RECONNECTING }

data class SseEvent(val id: String?, val event: String?, val data: String)

/**
 * Foreground-persistent SSE with auto-reconnect and Last-Event-ID resume —
 * port of mobile-kit's sse-client. Backgrounding kills the socket
 * eventually (OS behaviour, by design): callers reconnect on resume and
 * the delta-sync endpoint covers longer gaps.
 *
 * No sync events target drivers yet (picks stream on the STORE channel;
 * trips report by request/response) — the connection stays wired for the
 * status indicator and as the seam where trip.* events will land.
 */
class SseClient(
    http: OkHttpClient,
    private val url: suspend () -> String,
    private val headers: suspend () -> Map<String, String>,
    private val scope: CoroutineScope,
    private val onEvent: (SseEvent) -> Unit = {},
) {
    // Server heartbeats every 25s — a 90s read timeout detects dead sockets.
    private val http: OkHttpClient = http.newBuilder()
        .readTimeout(90, TimeUnit.SECONDS)
        .build()

    private val _state = MutableStateFlow(SseState.CLOSED)
    val state: StateFlow<SseState> = _state

    var lastEventId: String? = null
        private set

    private var job: Job? = null
    private var call: Call? = null

    fun connect() {
        if (_state.value != SseState.CLOSED) return
        _state.value = SseState.CONNECTING
        job = scope.launch { run() }
    }

    fun disconnect() {
        job?.cancel()
        job = null
        call?.cancel()
        call = null
        _state.value = SseState.CLOSED
    }

    /** Skip the backoff and reconnect now (app resume / network regain). */
    fun reconnectNow() {
        if (_state.value == SseState.CLOSED) return
        job?.cancel()
        call?.cancel()
        _state.value = SseState.CONNECTING
        job = scope.launch { run() }
    }

    private suspend fun run() {
        // Exponential backoff with full jitter: 1s base, doubling, 30s cap.
        var attempt = 0
        while (currentCoroutineContext().isActive) {
            try {
                val request = Request.Builder()
                    .url("${url()}/sse/channel")
                    .header("accept", "text/event-stream")
                    .apply {
                        for ((k, v) in headers()) header(k, v)
                        lastEventId?.let { header("last-event-id", it) }
                    }
                    .build()
                withContext(Dispatchers.IO) {
                    val active = http.newCall(request)
                    call = active
                    active.execute().use { res ->
                        if (!res.isSuccessful) error("SSE connect failed: ${res.code}")
                        _state.value = SseState.OPEN
                        attempt = 0
                        val source = res.body?.source() ?: error("SSE stream has no body")
                        // Event accumulator (id/event/data per SSE framing).
                        var id: String? = null
                        var eventName: String? = null
                        val data = StringBuilder()
                        while (true) {
                            val line = source.readUtf8Line() ?: break // server closed
                            when {
                                line.isEmpty() -> {
                                    if (data.isNotEmpty()) {
                                        if (id != null) lastEventId = id
                                        onEvent(SseEvent(id, eventName, data.toString()))
                                    }
                                    id = null
                                    eventName = null
                                    data.clear()
                                }
                                line.startsWith(":") -> {} // heartbeat/comment
                                line.startsWith("id:") -> id = line.substring(3).trim()
                                line.startsWith("event:") -> eventName = line.substring(6).trim()
                                line.startsWith("data:") -> {
                                    if (data.isNotEmpty()) data.append('\n')
                                    data.append(line.substring(5).trim())
                                }
                            }
                        }
                    }
                }
                error("SSE stream ended")
            } catch (err: CancellationException) {
                throw err // disconnected on purpose — don't reconnect
            } catch (err: Exception) {
                if (!currentCoroutineContext().isActive) return
                _state.value = SseState.RECONNECTING
                val ceiling = minOf(30_000L, 1_000L shl minOf(attempt, 10))
                attempt = minOf(attempt + 1, 10)
                delay(Random.nextLong(ceiling) + 500)
            }
        }
    }
}
