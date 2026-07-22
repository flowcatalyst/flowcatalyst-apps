package io.flowcatalyst.fulfilgo.execution.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

// The wire DTOs live in Generated.kt (emitted from @fulfil-go/shared's
// kotlin-contract registry — regenerate with `pnpm gen:kotlin` there).
// This file holds only client-side helpers.

/** Lenient shared instance: the server may add fields; we must not break. */
val AppJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = false
}

/** Error body of the driver/picker login + refresh endpoints. */
@Serializable
data class LoginErrorBody(val code: String? = null, val message: String? = null)

/** Status ordering shared by the overlay logic (mirror of the Vue app). */
val STATUS_RANK: Map<String, Int> = mapOf(
    "requested" to 0,
    "booked" to 1,
    "assigned" to 2,
    "collected" to 3,
    "delivered" to 4,
    "failed" to 4,
)
