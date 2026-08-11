package io.flowcatalyst.fulfilgo.execution.ui.work

import android.app.Application
import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import io.flowcatalyst.fulfilgo.execution.App
import io.flowcatalyst.fulfilgo.execution.api.AgeCheck
import io.flowcatalyst.fulfilgo.execution.api.AppJson
import io.flowcatalyst.fulfilgo.execution.api.MyTrip
import io.flowcatalyst.fulfilgo.execution.api.MyTripStop
import io.flowcatalyst.fulfilgo.execution.api.Offer
import io.flowcatalyst.fulfilgo.execution.api.PinCheckResult
import io.flowcatalyst.fulfilgo.execution.api.ReportBody
import io.flowcatalyst.fulfilgo.execution.api.STATUS_RANK
import io.flowcatalyst.fulfilgo.execution.core.ApiHttpException
import io.flowcatalyst.fulfilgo.execution.core.OverlayKind
import io.flowcatalyst.fulfilgo.execution.core.networkRegained
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import java.io.IOException
import java.time.Instant
import java.util.UUID

private val EMPTY_MESSAGES = mapOf(
    "NO_OFFERABLE_ORDERS" to "No deliveries waiting at your depot right now.",
    "ANCHOR_NOT_FOUND" to "No waiting delivery matches that number.",
    "ANCHOR_UNAVAILABLE" to "That delivery was just taken by another driver.",
    "DEPOT_SERVES_NO_STORES" to "Your depot has no stores linked — ask a manager.",
    "NO_STORE_ON_CLAIM_STRATEGY" to "No stores at your depot offer claimable work.",
    "OPEN_TRIP_EXISTS" to "Finish your current trip before claiming another.",
)

/** Which capture the camera feeds: proof-of-delivery photo or ID photo. */
enum class CaptureTarget { POD, ID }

class PinSheet(val trip: MyTrip, val stop: MyTripStop) {
    var pin by mutableStateOf("")
    var checking by mutableStateOf(false)
    var note by mutableStateOf<String?>(null)
}

class DeliverSheet(val trip: MyTrip, val stop: MyTripStop) {
    var pin by mutableStateOf("")
    var noPin by mutableStateOf(false)

    /** null = unchecked; offline = could not check (deferred). */
    var pinChecked by mutableStateOf<String?>(null) // verified | mismatch | offline
    var checking by mutableStateOf(false)
    var ageMethod by mutableStateOf<String?>(null) // id-attestation | visual-override
    var docType by mutableStateOf("id-card")
    var photoBase64 by mutableStateOf<String?>(null)
    var idPhotoBase64 by mutableStateOf<String?>(null)

    /** Signature strokes in pad-viewport coords (600×220), for PNG export. */
    val signatureStrokes = mutableStateListOf<List<Pair<Float, Float>>>()
    var photoBusy by mutableStateOf(false)
    var note by mutableStateOf<String?>(null)
}

/**
 * The claim marketplace + the driver's active trips — port of the Vue
 * OffersPage. COLLECTION + DELIVERY stay OFFLINE-FIRST: reports go direct
 * when online and queue through the outbox when not; pin checks are
 * interactive online (verify BEFORE handover) and deferred otherwise.
 */
class WorkViewModel(app: Application) : AndroidViewModel(app) {
    private val container = (app as App).container
    private val transport = container.transport
    private val prefs = container.prefs

    val driverSignedIn = container.driverSignedIn
    val driver = container.driver
    val sseState = container.sse.state

    var offer by mutableStateOf<Offer?>(null)
        private set
    var secondsLeft by mutableStateOf(0)
        private set
    var trips by mutableStateOf<List<MyTrip>>(emptyList())
        private set
    var emptyReason by mutableStateOf<String?>(null)
    var error by mutableStateOf<String?>(null)
    var busy by mutableStateOf(false)
    var anchorRef by mutableStateOf("")
    var reportBusy by mutableStateOf<String?>(null)
        private set

    var collectScanValue by mutableStateOf("")
    var scanBusy by mutableStateOf(false)
    var collectError by mutableStateOf<String?>(null)

    var pinSheet by mutableStateOf<PinSheet?>(null)
    var deliverSheet by mutableStateOf<DeliverSheet?>(null)
    var failDialogStop by mutableStateOf<Pair<MyTrip, MyTripStop>?>(null)

    // ── Offline-first local overlays (the Vue app's localStorage maps) ──
    val scannedByOrder = mutableStateMapOf<String, List<String>>()
    val pendingByOrder = mutableStateMapOf<String, String>()
    val arrivedByOrder = mutableStateMapOf<String, String>()

    private var countdownJob: Job? = null

    private val stringMap = MapSerializer(String.serializer(), String.serializer())
    private val stringListMap = MapSerializer(String.serializer(), ListSerializer(String.serializer()))

    init {
        viewModelScope.launch {
            scannedByOrder.putAll(AppJson.decodeFromString(stringListMap, prefs.loadOverlay(OverlayKind.SCANNED)))
            pendingByOrder.putAll(AppJson.decodeFromString(stringMap, prefs.loadOverlay(OverlayKind.PENDING)))
            arrivedByOrder.putAll(AppJson.decodeFromString(stringMap, prefs.loadOverlay(OverlayKind.ARRIVED)))
            loadMyTrips()
        }
        viewModelScope.launch {
            driverSignedIn.collect { if (it) loadMyTrips() }
        }
        viewModelScope.launch {
            // Network regain: drain queued reports, then refresh server truth.
            networkRegained(getApplication()).collect {
                container.outbox.flush()
                loadMyTrips()
            }
        }
    }

    private fun persistOverlays() {
        viewModelScope.launch {
            prefs.saveOverlay(OverlayKind.SCANNED, AppJson.encodeToString(stringListMap, scannedByOrder.toMap()))
            prefs.saveOverlay(OverlayKind.PENDING, AppJson.encodeToString(stringMap, pendingByOrder.toMap()))
            prefs.saveOverlay(OverlayKind.ARRIVED, AppJson.encodeToString(stringMap, arrivedByOrder.toMap()))
        }
    }

    private suspend fun clientId(): String = prefs.clientIdNow()

    val hasOpenTrip: Boolean get() = trips.isNotEmpty()

    fun emptyMessage(): String? =
        emptyReason?.let { EMPTY_MESSAGES[it] ?: "No work available right now." }

    /** Server status overlaid with locally-queued (not yet synced) actions. */
    fun effectiveStatus(stop: MyTripStop): String {
        val pending = pendingByOrder[stop.orderId]
        if (pending != null && (STATUS_RANK[pending] ?: 0) > (STATUS_RANK[stop.status] ?: 0)) return pending
        return stop.status
    }

    fun isPendingSync(stop: MyTripStop): Boolean =
        pendingByOrder.containsKey(stop.orderId) && effectiveStatus(stop) != stop.status

    fun collectingStops(trip: MyTrip): List<MyTripStop> =
        trip.stops.filter { effectiveStatus(it) == "assigned" }

    fun needsCollection(trip: MyTrip): Boolean = collectingStops(trip).isNotEmpty()

    fun scannedFor(stop: MyTripStop): List<String> = scannedByOrder[stop.orderId] ?: emptyList()

    fun stopFullyScanned(stop: MyTripStop): Boolean =
        stop.parcels.isNotEmpty() && stop.parcels.all { scannedFor(stop).contains(it.ref) }

    fun tripHasScannableParcels(trip: MyTrip): Boolean =
        collectingStops(trip).any { it.parcels.isNotEmpty() }

    fun effectiveProof(stop: MyTripStop): String {
        val reqs = stop.verification?.requirements ?: return "none"
        return reqs.deliveryProof ?: if (reqs.deliveryPin == true) "pin" else "none"
    }

    /** The stop the driver works NOW: first non-terminal, in route order. */
    fun activeStopId(trip: MyTrip): String? =
        trip.stops.firstOrNull { effectiveStatus(it) == "collected" }?.orderId

    fun loadMyTrips() {
        viewModelScope.launch {
            if (!driverSignedIn.value) return@launch
            try {
                val res = transport.myTrips(clientId())
                trips = res.trips
                pruneOverlays(res.trips)
            } catch (_: Exception) {
                // Offline / stale session — keep whatever we had; next load recovers.
            }
        }
    }

    /** Server caught up: prune local overlays so storage never grows unbounded. */
    private fun pruneOverlays(live: List<MyTrip>) {
        val liveStops = live.flatMap { it.stops }.associateBy { it.orderId }
        for (orderId in pendingByOrder.keys.toList()) {
            val stop = liveStops[orderId]
            if (stop == null ||
                (STATUS_RANK[stop.status] ?: 0) >= (STATUS_RANK[pendingByOrder[orderId]] ?: 0)
            ) {
                pendingByOrder.remove(orderId)
            }
        }
        for (orderId in scannedByOrder.keys.toList()) {
            val stop = liveStops[orderId]
            if (stop == null || (STATUS_RANK[stop.status] ?: 0) >= STATUS_RANK.getValue("collected")) {
                scannedByOrder.remove(orderId)
            }
        }
        for (orderId in arrivedByOrder.keys.toList()) {
            val stop = liveStops[orderId]
            if (stop == null || (STATUS_RANK[stop.status] ?: 0) >= STATUS_RANK.getValue("delivered")) {
                arrivedByOrder.remove(orderId)
            }
        }
        persistOverlays()
    }

    // ── Offer / claim ──

    fun findWork() {
        // Re-entrancy guard: a double tap composes TWO offers back-to-back and
        // the second steals the first's reservations — the rendered offer then
        // 410s on claim while looking perfectly valid.
        if (busy) return
        viewModelScope.launch {
            busy = true
            error = null
            emptyReason = null
            try {
                val res = transport.findOffers(clientId(), anchorRef)
                if (res.offers.isEmpty()) {
                    emptyReason = res.reason ?: "NO_OFFERABLE_ORDERS"
                    offer = null
                    return@launch
                }
                offer = res.offers.first()
                startCountdown(res.offers.first().expiresInSeconds)
            } catch (err: Exception) {
                error = err.message ?: err.toString()
            } finally {
                busy = false
            }
        }
    }

    fun claim() {
        val current = offer ?: return
        if (busy) return
        viewModelScope.launch {
            busy = true
            error = null
            try {
                transport.claim(clientId(), current.groupId)
                offer = null
                stopCountdown()
                loadMyTrips()
            } catch (err: ApiHttpException) {
                offer = null
                stopCountdown()
                // Only 410 is genuinely "expired" — labelling every failure
                // that way sent us chasing clock bugs (2026-08-10).
                error = when (err.status) {
                    410 -> "That offer expired — find work again."
                    409 -> "You already have an open trip — finish it before claiming another."
                    else -> "Claim failed (${err.status}): ${err.bodyText.take(140)}"
                }
            } catch (err: Exception) {
                // Network-level failure — the hold lapses on its own.
                offer = null
                stopCountdown()
                error = "Network problem while claiming — find work again. (${err.message ?: "offline"})"
            } finally {
                busy = false
            }
        }
    }

    fun passOffer() {
        // Walking away is fine — the hold lapses on its own (EPOD semantics).
        offer = null
        stopCountdown()
    }

    private fun startCountdown(expiresInSeconds: Double) {
        stopCountdown()
        // Server-provided DURATION on the monotonic clock — never compare the
        // server's expiresAt timestamp to the device wall clock: device/server
        // skew (emulators especially) makes dead offers look claimable.
        val expiryElapsed = SystemClock.elapsedRealtime() + (expiresInSeconds * 1000).toLong()
        countdownJob = viewModelScope.launch {
            while (true) {
                val left =
                    ((expiryElapsed - SystemClock.elapsedRealtime()) / 1000.0).toInt()
                        .coerceAtLeast(0)
                secondsLeft = left
                if (left == 0) {
                    // Hold lapsed — the reservation frees itself server-side.
                    offer = null
                    error = "That offer expired — find work again."
                    break
                }
                delay(500)
            }
        }
    }

    private fun stopCountdown() {
        countdownJob?.cancel()
        countdownJob = null
    }

    // ── Reporting (offline-first: direct → queue on network failure) ──

    /** true = landed or queued; false = server refused (message in [error]). */
    private suspend fun submitReport(
        trip: MyTrip,
        orderId: String?,
        action: String,
        body: ReportBody,
    ): Boolean {
        val path = transport.reportPath(clientId(), trip.tripId, orderId, action)
        reportBusy = orderId ?: trip.tripId
        error = null
        try {
            val res = try {
                container.api.request(path, method = "POST", jsonBody = transport.encodeReport(body))
            } catch (_: IOException) {
                // Network down — hand to the offline outbox and carry on. The
                // server verifies the evidence when it drains.
                container.outbox.enqueue(path, "POST", transport.encodeReport(body))
                if (orderId != null) pendingByOrder[orderId] = action
                else for (s in trip.stops) pendingByOrder.putIfAbsent(s.orderId, "collected")
                persistOverlays()
                return true
            }
            if (!res.ok) {
                error = "Failed (${res.status}): ${res.bodyText.take(300)}"
                return false
            }
            loadMyTrips()
            return true
        } finally {
            reportBusy = null
        }
    }

    // ── Collection: scan parcels per stop, PIN override per order ──

    fun applyCollectScan(trip: MyTrip, code: String) {
        val value = code.trim()
        if (value.isEmpty()) return
        collectError = null
        val stop = collectingStops(trip).firstOrNull { s -> s.parcels.any { it.ref == value } }
        if (stop == null) {
            collectError = "No parcel on this trip matches '$value'."
            return
        }
        val scanned = scannedByOrder[stop.orderId] ?: emptyList()
        if (scanned.contains(value)) {
            collectError = "'$value' is already scanned."
            return
        }
        scannedByOrder[stop.orderId] = scanned + value
        persistOverlays()
        // Every parcel of this order accounted for → the order is collected.
        if (stopFullyScanned(stop)) {
            viewModelScope.launch {
                submitReport(
                    trip,
                    stop.orderId,
                    "collected",
                    ReportBody(method = "scan", scannedRefs = scannedByOrder[stop.orderId]),
                )
            }
        }
    }

    fun onCollectWedgeScan(trip: MyTrip) {
        applyCollectScan(trip, collectScanValue)
        collectScanValue = ""
    }

    fun cameraCollectScan(trip: MyTrip) {
        viewModelScope.launch {
            scanBusy = true
            collectError = null
            try {
                val context = getApplication<Application>()
                val scanner = GmsBarcodeScanning.getClient(context)
                // First run may need the scanner module — request install once.
                runCatching {
                    ModuleInstall.getClient(context)
                        .installModules(ModuleInstallRequest.newBuilder().addApi(scanner).build())
                        .await()
                }
                val barcode = scanner.startScan().await()
                barcode.rawValue?.let { applyCollectScan(trip, it) }
            } catch (err: Exception) {
                collectError = err.message ?: err.toString()
            } finally {
                scanBusy = false
            }
        }
    }

    // Pickup-PIN override: the STORE reads the pin out when a label won't
    // scan. Online we verify interactively first; offline the entered pin
    // rides the queued report (deferred verification).
    fun openPinOverride(trip: MyTrip, stop: MyTripStop) {
        pinSheet = PinSheet(trip, stop)
    }

    fun confirmPinOverride() {
        val sheet = pinSheet ?: return
        val pin = sheet.pin.trim()
        if (pin.isEmpty()) return
        viewModelScope.launch {
            sheet.checking = true
            sheet.note = null
            try {
                val checked: PinCheckResult = try {
                    transport.verifyPin(clientId(), sheet.trip.tripId, sheet.stop.orderId, "pickup", pin)
                } catch (_: IOException) {
                    PinCheckResult.DEFERRED // offline — deferred verification on the report
                }
                when (checked) {
                    PinCheckResult.RATE_LIMITED -> {
                        sheet.note = "Too many attempts — wait a few minutes."
                        return@launch
                    }
                    PinCheckResult.MISMATCH -> {
                        sheet.note = "Wrong PIN — check with store staff."
                        return@launch
                    }
                    else -> {}
                }
                val ok = submitReport(
                    sheet.trip,
                    sheet.stop.orderId,
                    "collected",
                    ReportBody(method = "pin", pinEntered = pin),
                )
                if (ok) {
                    pinSheet = null
                    collectError = null
                }
            } finally {
                sheet.checking = false
            }
        }
    }

    /** Legacy escape: orders without parcel refs can't scan — one bulk button. */
    fun bulkCollect(trip: MyTrip) {
        viewModelScope.launch { submitReport(trip, null, "collected", ReportBody()) }
    }

    // ── Guided stop sequence: navigate → arrived → proof → delivered ──

    fun markArrived(stop: MyTripStop) {
        arrivedByOrder[stop.orderId] = Instant.now().toString()
        persistOverlays()
    }

    // ── Delivery: pin + age verification at the door ──

    fun openDeliver(trip: MyTrip, stop: MyTripStop) {
        val reqs = stop.verification?.requirements
        if (effectiveProof(stop) == "none" && (reqs == null || reqs.minAge == null)) {
            // Nothing to verify — deliver straight away, no sheet ceremony.
            viewModelScope.launch {
                submitReport(
                    trip,
                    stop.orderId,
                    "delivered",
                    ReportBody(arrivedAt = arrivedByOrder[stop.orderId]),
                )
            }
            return
        }
        deliverSheet = DeliverSheet(trip, stop)
    }

    /** Verify BEFORE handover when online — wrong pin means keep the goods. */
    fun checkDeliveryPin() {
        val sheet = deliverSheet ?: return
        val pin = sheet.pin.trim()
        if (pin.isEmpty()) return
        viewModelScope.launch {
            sheet.checking = true
            sheet.note = null
            try {
                val checked = try {
                    transport.verifyPin(clientId(), sheet.trip.tripId, sheet.stop.orderId, "delivery", pin)
                } catch (_: IOException) {
                    sheet.pinChecked = "offline"
                    sheet.note = "Offline — the PIN will be verified when the report syncs."
                    return@launch
                }
                when (checked) {
                    PinCheckResult.VERIFIED -> sheet.pinChecked = "verified"
                    PinCheckResult.MISMATCH -> {
                        sheet.pinChecked = "mismatch"
                        sheet.note = "Wrong PIN — do not hand over. Ask again or fail the stop."
                    }
                    PinCheckResult.RATE_LIMITED -> sheet.note = "Too many attempts — wait a few minutes."
                    PinCheckResult.DEFERRED -> sheet.pinChecked = "offline"
                }
            } finally {
                sheet.checking = false
            }
        }
    }

    fun setCapturedPhoto(target: CaptureTarget, base64: String?) {
        val sheet = deliverSheet ?: return
        when (target) {
            CaptureTarget.POD -> sheet.photoBase64 = base64
            CaptureTarget.ID -> sheet.idPhotoBase64 = base64
        }
    }

    fun drawerIdPhotoRequired(sheet: DeliverSheet): Boolean =
        sheet.stop.verification?.requirements?.ageIdPhotoRequired == true

    fun canDeliver(sheet: DeliverSheet): Boolean {
        val reqs = sheet.stop.verification?.requirements
            ?: io.flowcatalyst.fulfilgo.execution.api.VerificationRequirements()
        val proof = effectiveProof(sheet.stop)
        if (reqs.minAge != null && sheet.ageMethod == null) return false
        if (reqs.minAge != null && drawerIdPhotoRequired(sheet) &&
            sheet.ageMethod == "id-attestation" && sheet.idPhotoBase64 == null
        ) {
            return false
        }
        if (proof == "pin" && !sheet.noPin && sheet.pin.isBlank()) return false
        if (proof == "picture" && sheet.photoBase64 == null) return false
        if (proof == "signature" && sheet.signatureStrokes.isEmpty()) return false
        return true
    }

    /**
     * Upload a captured image with a CLIENT-GENERATED ref so the evidence
     * can reference it even when everything queues offline (FIFO: blob
     * before the report). Returns the ref, or null when the server REFUSED.
     */
    private suspend fun uploadBlob(prefix: String, base64: String, contentType: String): String? {
        val blobRef = "${prefix}_${UUID.randomUUID().toString().replace("-", "").take(20)}"
        val path = transport.blobPath(clientId(), blobRef)
        val body = transport.encodeBlob(base64, contentType)
        try {
            val res = container.api.request(path, method = "PUT", jsonBody = body)
            if (!res.ok) return null
        } catch (_: IOException) {
            // Offline — the blob drains from the outbox before the report does.
            container.outbox.enqueue(path, "PUT", body)
        }
        return blobRef
    }

    fun confirmDeliver(signatureBase64: String?) {
        val sheet = deliverSheet ?: return
        if (!canDeliver(sheet)) return
        viewModelScope.launch {
            val reqs = sheet.stop.verification?.requirements
            val proof = effectiveProof(sheet.stop)
            var ageCheck: AgeCheck? = null
            if (reqs?.minAge != null && sheet.ageMethod != null) {
                var idPhotoRef: String? = null
                if (sheet.ageMethod == "id-attestation" && sheet.idPhotoBase64 != null) {
                    idPhotoRef = uploadBlob("id", sheet.idPhotoBase64!!, "image/jpeg")
                    if (idPhotoRef == null) {
                        sheet.note = "ID photo upload failed — try again."
                        return@launch
                    }
                }
                ageCheck = AgeCheck(
                    method = sheet.ageMethod!!,
                    docType = if (sheet.ageMethod == "id-attestation") sheet.docType else null,
                    idPhotoRef = idPhotoRef,
                )
            }
            var photoRef: String? = null
            if (proof == "picture" && sheet.photoBase64 != null) {
                photoRef = uploadBlob("pod", sheet.photoBase64!!, "image/jpeg")
                if (photoRef == null) {
                    sheet.note = "Photo upload failed — try again."
                    return@launch
                }
            }
            var signatureRef: String? = null
            if (proof == "signature" && signatureBase64 != null) {
                signatureRef = uploadBlob("sig", signatureBase64, "image/png")
                if (signatureRef == null) {
                    sheet.note = "Signature upload failed — try again."
                    return@launch
                }
            }
            val body = ReportBody(
                pinEntered = if (proof == "pin" && !sheet.noPin && sheet.pin.isNotBlank()) sheet.pin.trim() else null,
                ageCheck = ageCheck,
                photoRef = photoRef,
                signatureRef = signatureRef,
                arrivedAt = arrivedByOrder[sheet.stop.orderId],
            )
            val ok = submitReport(sheet.trip, sheet.stop.orderId, "delivered", body)
            if (ok) deliverSheet = null
        }
    }

    fun failStop(trip: MyTrip, stop: MyTripStop, reason: String) {
        viewModelScope.launch {
            submitReport(
                trip,
                stop.orderId,
                "failed",
                ReportBody(reason = reason, arrivedAt = arrivedByOrder[stop.orderId]),
            )
        }
    }

    override fun onCleared() {
        stopCountdown()
        super.onCleared()
    }
}
