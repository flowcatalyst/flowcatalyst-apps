package io.flowcatalyst.fulfilgo.execution.outbox

import io.flowcatalyst.fulfilgo.execution.core.ApiClient
import io.flowcatalyst.fulfilgo.execution.db.OutboxDao
import io.flowcatalyst.fulfilgo.execution.db.OutboxItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.IOException
import java.util.UUID
import kotlin.math.min

private const val FLUSH_BATCH = 20
private const val MAX_ATTEMPTS = 8
private const val BASE_RETRY_MS = 5_000L
private const val MAX_RETRY_MS = 5 * 60_000L

/**
 * Client-side outbox — port of mobile-kit's offline queue. Every item
 * carries a generated Idempotency-Key, so at-least-once delivery is safe:
 * the server replays the stored response for keys it has seen.
 *
 * Outcomes: 2xx → done; 429/5xx → exponential backoff, capped at
 * MAX_ATTEMPTS; NETWORK errors → backoff WITHOUT consuming attempts (being
 * offline for an hour must never dead-letter completed work); any other
 * 4xx → dead-letter for the Settings dead-letter UI.
 */
class OutboxQueue(
    private val dao: OutboxDao,
    private val api: ApiClient,
    private val scope: CoroutineScope,
) {
    private val flushMutex = Mutex()
    private var inFlight: Deferred<Unit>? = null

    val dead: Flow<List<OutboxItem>> = dao.dead()
    val pendingCount: Flow<Int> = dao.pendingCount()

    suspend fun enqueue(endpoint: String, method: String = "POST", body: String? = null) {
        val now = System.currentTimeMillis()
        dao.insert(
            OutboxItem(
                id = UUID.randomUUID().toString(),
                endpoint = endpoint,
                method = method,
                body = body,
                idempotencyKey = UUID.randomUUID().toString(),
                attempts = 0,
                nextAttemptAt = now,
                status = "pending",
                lastError = null,
                createdAt = now,
            ),
        )
        scope.launch { flush() }
    }

    /** Drain due items now (network regain / app resume / manual retry). */
    suspend fun flush() {
        // Concurrent callers join the in-flight drain instead of racing it.
        val job = flushMutex.withLock {
            inFlight ?: scope.async {
                try {
                    doFlush()
                } finally {
                    flushMutex.withLock { inFlight = null }
                }
            }.also { inFlight = it }
        }
        job.await()
    }

    private suspend fun doFlush() {
        while (true) {
            val due = dao.listDue(System.currentTimeMillis(), FLUSH_BATCH)
            if (due.isEmpty()) break
            for (item in due) deliver(item)
            if (due.size < FLUSH_BATCH) break
        }
    }

    private suspend fun deliver(item: OutboxItem) {
        var lastError: String? = null
        val outcome: String = try {
            val res = api.request(
                item.endpoint,
                method = item.method,
                jsonBody = item.body,
                headers = mapOf("idempotency-key" to item.idempotencyKey),
            )
            when {
                res.ok -> "done"
                res.status == 429 || res.status >= 500 -> {
                    lastError = "HTTP ${res.status}"
                    "retry-http"
                }
                else -> {
                    lastError = "HTTP ${res.status}: ${res.bodyText.take(500)}"
                    "dead"
                }
            }
        } catch (err: IOException) {
            lastError = err.message ?: err.toString()
            "retry-network"
        }

        if (outcome == "done") {
            dao.remove(item.id)
            return
        }
        // Offline is patient: attempts only accrue on real HTTP failures.
        val attempts = if (outcome == "retry-network") item.attempts else item.attempts + 1
        if (outcome == "dead" || attempts >= MAX_ATTEMPTS) {
            dao.update(item.copy(attempts = attempts, status = "dead", lastError = lastError))
            return
        }
        dao.update(
            item.copy(
                attempts = attempts,
                nextAttemptAt = System.currentTimeMillis() + retryDelay(attempts),
                lastError = lastError,
            ),
        )
    }

    private fun retryDelay(attempts: Int): Long =
        min(MAX_RETRY_MS, BASE_RETRY_MS * (1L shl min(attempts, 20)))

    suspend fun retryDead(id: String) {
        val item = dao.byId(id) ?: return
        if (item.status != "dead") return
        dao.update(
            item.copy(
                status = "pending",
                attempts = 0,
                nextAttemptAt = System.currentTimeMillis(),
                lastError = null,
            ),
        )
        scope.launch { flush() }
    }

    suspend fun discardDead(id: String) = dao.remove(id)
}
