package io.flowcatalyst.fulfilgo.execution.api

import io.flowcatalyst.fulfilgo.execution.core.ApiClient
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Typed calls over the raw client — shaped per screen, not per table
 * (matching the server's CQRS-lite read side).
 */
class TransportApi(private val api: ApiClient) {

    suspend fun driverMe(clientId: String): DriverMe =
        AppJson.decodeFromString(api.json("/clients/$clientId/driver-auth/me"))

    suspend fun findOffers(clientId: String, anchorRef: String?): OffersResponse {
        val body = buildJsonObject {
            if (!anchorRef.isNullOrBlank()) put("orderReference", anchorRef.trim())
        }
        return AppJson.decodeFromString(
            api.json("/clients/$clientId/transport/offers", method = "POST", jsonBody = body.toString()),
        )
    }

    suspend fun claim(clientId: String, groupId: String) {
        api.json("/clients/$clientId/transport/offers/$groupId/claim", method = "POST")
    }

    suspend fun myTrips(clientId: String): TripsResponse =
        AppJson.decodeFromString(api.json("/clients/$clientId/transport/my-trips"))

    fun reportPath(clientId: String, tripId: String, orderId: String?, action: String): String {
        val base = "/clients/$clientId/transport/my-trips/$tripId"
        return if (action == "collected" && orderId == null) "$base/collected"
        else "$base/stops/$orderId/$action"
    }

    fun encodeReport(body: ReportBody): String = AppJson.encodeToString(body)

    /** null = offline / non-OK non-429 (deferred verification). */
    suspend fun verifyPin(
        clientId: String,
        tripId: String,
        orderId: String,
        kind: String,
        pin: String,
    ): PinCheckResult {
        val body = buildJsonObject {
            put("kind", kind)
            put("pin", pin)
        }
        val res = api.request(
            "/clients/$clientId/transport/my-trips/$tripId/stops/$orderId/verify-pin",
            method = "POST",
            jsonBody = body.toString(),
        )
        return when {
            res.ok -> {
                val verified = AppJson.decodeFromString<VerifyPinResponse>(res.bodyText).verified
                if (verified) PinCheckResult.VERIFIED else PinCheckResult.MISMATCH
            }
            res.status == 429 -> PinCheckResult.RATE_LIMITED
            else -> PinCheckResult.DEFERRED // pin not set etc. — server records outcome on the report
        }
    }

    fun blobPath(clientId: String, blobRef: String): String = "/clients/$clientId/pod-photos/$blobRef"

    fun encodeBlob(imageBase64: String, contentType: String): String =
        AppJson.encodeToString(BlobUpload(imageBase64, contentType))
}

enum class PinCheckResult { VERIFIED, MISMATCH, RATE_LIMITED, DEFERRED }
