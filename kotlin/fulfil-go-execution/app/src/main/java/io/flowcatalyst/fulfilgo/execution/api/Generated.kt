// GENERATED FILE — DO NOT EDIT.
// Source of truth: @fulfil-go/shared src/api/kotlin-contract.ts
// Regenerate: pnpm --filter @fulfil-go/shared gen:kotlin
package io.flowcatalyst.fulfilgo.execution.api

import kotlinx.serialization.Serializable

@Serializable
data class PickerTokenResponse(
    val tokenType: String,
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Int,
)

@Serializable
data class MobileTokenResponse(
    val accessToken: String,
    val refreshToken: String? = null,
    val expiresAt: Long,
)

@Serializable
data class AuthorizeUrlResponse(
    val url: String,
)

@Serializable
data class DriverMe(
    val driverId: String,
    val clientId: String,
    val depotRef: String,
    val displayName: String? = null,
    val defaultVehicleReg: String? = null,
    val defaultVehicleClass: String? = null,
    val permissions: List<String>,
)

@Serializable
data class Geo(
    val lat: Double,
    val lng: Double,
)

@Serializable
data class Address(
    val line1: String? = null,
    val line2: String? = null,
    val suburb: String? = null,
    val city: String? = null,
    val region: String? = null,
    val postalCode: String? = null,
    val countryCode: String? = null,
)

@Serializable
data class Destination(
    val name: String? = null,
    val address: Address? = null,
    val geo: Geo? = null,
    val phone: String? = null,
    val instructions: String? = null,
)

@Serializable
data class OfferStop(
    val orderId: String,
    val shortId: String,
    val destination: Destination,
    val legKm: Double? = null,
    val legMinutes: Double? = null,
)

@Serializable
data class Offer(
    val groupId: String,
    val depotNames: List<String>,
    val partReferences: List<String>,
    val transportOrderRefs: List<String>,
    val expiresAt: String,
    val expiresInSeconds: Double,
    val originRef: String,
    val stops: List<OfferStop>,
    val routeKm: Double? = null,
    val routeMinutes: Double? = null,
)

@Serializable
data class OffersResponse(
    val offers: List<Offer>,
    val reason: String? = null,
)

@Serializable
data class StopParcel(
    val ref: String,
    val kind: String,
    val size: String? = null,
    val temperature: String,
)

@Serializable
data class VerificationRequirements(
    val pickupPin: Boolean? = null,
    val deliveryPin: Boolean? = null,
    val deliveryProof: String? = null,
    val minAge: Int? = null,
    val ageVisualOverrideAllowed: Boolean? = null,
    val ageIdPhotoRequired: Boolean? = null,
)

@Serializable
data class StopVerification(
    val requirements: VerificationRequirements,
    val collectionMethod: String? = null,
    val deliveryPinOutcome: String? = null,
)

@Serializable
data class MyTripStop(
    val orderId: String,
    val shortId: String,
    val destination: Destination,
    val legKm: Double? = null,
    val legMinutes: Double? = null,
    val status: String,
    val parcels: List<StopParcel>,
    val verification: StopVerification? = null,
)

@Serializable
data class MyTrip(
    val tripId: String,
    val originRef: String,
    val claimedAt: String,
    val routeKm: Double? = null,
    val routeMinutes: Double? = null,
    val stops: List<MyTripStop>,
)

@Serializable
data class TripsResponse(
    val trips: List<MyTrip>,
)

@Serializable
data class AgeCheck(
    val method: String, // 'id-attestation' | 'visual-override'
    val docType: String? = null,
    val idPhotoRef: String? = null,
)

@Serializable
data class ReportBody(
    val reason: String? = null,
    val method: String? = null, // 'scan' | 'pin'
    val scannedRefs: List<String>? = null,
    val pinEntered: String? = null,
    val ageCheck: AgeCheck? = null,
    val photoRef: String? = null,
    val signatureRef: String? = null,
    val arrivedAt: String? = null,
)

@Serializable
data class TripReportResponse(
    val updatedOrders: List<String>,
    val allCollected: Boolean,
    val tripCompleted: Boolean,
    val pinOutcome: String? = null,
    val note: String? = null,
)

@Serializable
data class VerifyPinResponse(
    val verified: Boolean,
)

@Serializable
data class BlobUpload(
    val imageBase64: String,
    val contentType: String, // 'image/jpeg' | 'image/png'
)
