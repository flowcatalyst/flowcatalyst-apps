package io.flowcatalyst.fulfilgo.execution.ui.work

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import io.flowcatalyst.fulfilgo.execution.api.MyTrip
import io.flowcatalyst.fulfilgo.execution.api.MyTripStop
import io.flowcatalyst.fulfilgo.execution.core.SseState
import java.io.File
import java.time.Year

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkScreen(vm: WorkViewModel, onDriverLogin: () -> Unit) {
    val signedIn by vm.driverSignedIn.collectAsState()
    val driver by vm.driver.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (!signedIn) {
            Card {
                Text(
                    "Sign in with your staff code + PIN to see claimable work.",
                    modifier = Modifier.padding(16.dp),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            Button(onClick = onDriverLogin, modifier = Modifier.fillMaxWidth()) {
                Text("Driver sign in")
            }
            return@Column
        }

        // Driver header
        val sseState by vm.sseState.collectAsState()
        Card {
            Column(Modifier.padding(16.dp)) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        driver?.displayName ?: "Driver",
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Text(
                        if (sseState == SseState.OPEN) "● live" else "○ offline",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (sseState == SseState.OPEN) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(
                    buildString {
                        append("Depot ${driver?.depotRef ?: "—"}")
                        driver?.defaultVehicleReg?.let { append(" · $it") }
                        driver?.defaultVehicleClass?.let { append(" ($it)") }
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // Find work (hidden while a trip is OPEN — one active trip per driver).
        if (vm.offer == null && !vm.hasOpenTrip) {
            OutlinedTextField(
                value = vm.anchorRef,
                onValueChange = { vm.anchorRef = it },
                placeholder = { Text("Part number (optional — e.g. 1024)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            Button(
                onClick = { vm.findWork() },
                enabled = !vm.busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (vm.busy) CircularProgressIndicator(Modifier.padding(end = 8.dp))
                Text("Find work")
            }
            vm.emptyMessage()?.let {
                Card { Text(it, Modifier.padding(16.dp), style = MaterialTheme.typography.bodyMedium) }
            }
        }
        if (vm.hasOpenTrip && vm.offer == null) {
            Card {
                Text(
                    "Finish your current trip to claim more work.",
                    Modifier.padding(16.dp),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }

        vm.offer?.let { offer -> OfferCard(vm, offer) }

        if (vm.trips.isNotEmpty()) {
            Text("My trips", style = MaterialTheme.typography.titleSmall)
            for (trip in vm.trips) {
                TripCard(vm, trip)
            }
        }

        vm.error?.let {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                Text(it, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onErrorContainer)
            }
        }
    }

    vm.pinSheet?.let { PinOverrideSheet(vm, it) }
    vm.deliverSheet?.let { DeliverSheet(vm, it) }
    vm.failDialogStop?.let { (trip, stop) -> FailDialog(vm, trip, stop) }
}

@Composable
private fun OfferCard(vm: WorkViewModel, offer: io.flowcatalyst.fulfilgo.execution.api.Offer) {
    Card(colors = CardDefaults.elevatedCardColors()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "${offer.stops.size} stop trip from ${offer.originRef}",
                    style = MaterialTheme.typography.titleSmall,
                )
                Badge(
                    containerColor = if (vm.secondsLeft > 10) MaterialTheme.colorScheme.primaryContainer
                    else MaterialTheme.colorScheme.errorContainer,
                ) {
                    Text("${vm.secondsLeft}s")
                }
            }
            offer.stops.forEachIndexed { i, s ->
                Text(
                    buildString {
                        append("${i + 1}. #${s.shortId} ${s.destination.name ?: ""}")
                        s.destination.address?.line1?.let { append(" · $it") }
                        s.legKm?.let { append(" · %.1f km".format(it)) }
                    },
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            offer.routeKm?.let {
                Text(
                    "Route ≈ %.1f km · %d min".format(it, (offer.routeMinutes ?: 0.0).toInt()),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { vm.claim() },
                    enabled = !vm.busy && vm.secondsLeft > 0,
                    modifier = Modifier.weight(1f),
                ) { Text("Claim trip") }
                OutlinedButton(onClick = { vm.passOffer() }) { Text("Pass") }
            }
        }
    }
}

@Composable
private fun TripCard(vm: WorkViewModel, trip: MyTrip) {
    Card {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                buildString {
                    append("Collect at ${trip.originRef}")
                    trip.routeKm?.let { append(" · ≈%.1f km".format(it)) }
                },
                style = MaterialTheme.typography.titleSmall,
            )

            // ══ COLLECTION: scan each bag; a fully-scanned order confirms
            //    itself. PIN override per order when a label won't scan. ══
            if (vm.needsCollection(trip)) {
                CollectionSection(vm, trip)
                HorizontalDivider()
            }

            // ══ GUIDED STOPS: route order — navigate → arrived → proof →
            //    delivered; the next stop then unlocks. ══
            trip.stops.forEachIndexed { i, stop -> StopRow(vm, trip, stop, i) }
        }
    }
}

@Composable
private fun CollectionSection(vm: WorkViewModel, trip: MyTrip) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("📷 Collection — scan the bags", style = MaterialTheme.typography.titleSmall)
        if (vm.tripHasScannableParcels(trip)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = vm.collectScanValue,
                    onValueChange = { vm.collectScanValue = it },
                    placeholder = { Text("Scan bag barcode…") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { vm.onCollectWedgeScan(trip) }),
                )
                FilledTonalButton(onClick = { vm.cameraCollectScan(trip) }, enabled = !vm.scanBusy) {
                    Text("📷")
                }
            }
        }
        vm.collectError?.let {
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        for (stop in vm.collectingStops(trip)) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        buildString {
                            append("#${stop.shortId}")
                            if (stop.parcels.isNotEmpty()) {
                                append("  ${vm.scannedFor(stop).size} / ${stop.parcels.size} scanned")
                            }
                        },
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    TextButton(onClick = { vm.openPinOverride(trip, stop) }) {
                        Text("Can't scan? Store PIN")
                    }
                }
                if (stop.parcels.isNotEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        for (parcel in stop.parcels) {
                            val scanned = vm.scannedFor(stop).contains(parcel.ref)
                            AssistChip(
                                onClick = {},
                                label = {
                                    Text(
                                        (if (scanned) "✓ " else "") + parcel.ref,
                                        fontFamily = FontFamily.Monospace,
                                        style = MaterialTheme.typography.labelSmall,
                                    )
                                },
                            )
                        }
                    }
                }
            }
        }
        // Orders without parcel refs can't scan-match: bulk escape.
        if (!vm.tripHasScannableParcels(trip)) {
            Button(
                onClick = { vm.bulkCollect(trip) },
                enabled = vm.reportBusy != trip.tripId,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Collected — leaving the store") }
        }
    }
}

@Composable
private fun StopRow(vm: WorkViewModel, trip: MyTrip, stop: MyTripStop, index: Int) {
    val context = LocalContext.current
    val status = vm.effectiveStatus(stop)
    val isActive = vm.activeStopId(trip) == stop.orderId && !vm.needsCollection(trip)

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    "${index + 1}. #${stop.shortId} ${stop.destination.name ?: ""}",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    buildString {
                        stop.destination.address?.line1?.let { append(it) }
                        stop.verification?.requirements?.minAge?.let { append(" · 🔞 $it+") }
                        when (vm.effectiveProof(stop)) {
                            "pin" -> append(" · 🔑 PIN")
                            "picture" -> append(" · 📷 photo")
                            "signature" -> append(" · ✍️ signature")
                        }
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (vm.isPendingSync(stop)) {
                Badge(containerColor = MaterialTheme.colorScheme.tertiaryContainer) { Text("syncing…") }
            }
            when {
                status != "collected" -> Badge(
                    containerColor = when (status) {
                        "delivered" -> MaterialTheme.colorScheme.primaryContainer
                        "failed" -> MaterialTheme.colorScheme.errorContainer
                        else -> MaterialTheme.colorScheme.surfaceVariant
                    },
                ) { Text(if (status == "assigned") "to collect" else status) }

                !isActive -> Badge(containerColor = MaterialTheme.colorScheme.surfaceVariant) {
                    Text("waiting")
                }
            }
        }

        // The ACTIVE stop's journey: navigate → arrived → proof.
        if (isActive && status == "collected") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(mapsUri(stop))))
                }) { Text("🧭 Navigate") }
                if (vm.arrivedByOrder[stop.orderId] == null) {
                    Button(onClick = { vm.markArrived(stop) }) { Text("📍 I've arrived") }
                } else {
                    Button(
                        onClick = { vm.openDeliver(trip, stop) },
                        enabled = vm.reportBusy != stop.orderId,
                    ) { Text("Delivered") }
                    OutlinedButton(
                        onClick = { vm.failDialogStop = trip to stop },
                        enabled = vm.reportBusy != stop.orderId,
                    ) { Text("Failed") }
                }
            }
        }
    }
}

/** Default maps app via geo: intent (label falls back to the short id). */
private fun mapsUri(stop: MyTripStop): String {
    val geo = stop.destination.geo
    val label = Uri.encode(stop.destination.name ?: "Stop #${stop.shortId}")
    if (geo != null) return "geo:${geo.lat},${geo.lng}?q=${geo.lat},${geo.lng}($label)"
    val q = Uri.encode(
        listOfNotNull(stop.destination.name, stop.destination.address?.line1, stop.destination.address?.city)
            .joinToString(", "),
    )
    return "geo:0,0?q=$q"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PinOverrideSheet(vm: WorkViewModel, sheet: PinSheet) {
    ModalBottomSheet(onDismissRequest = { vm.pinSheet = null }) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Store PIN override", style = MaterialTheme.typography.titleMedium)
            Text(
                "Ask store staff for the pickup PIN for #${sheet.stop.shortId} — they can read it " +
                    "from their station or the flightboard.",
                style = MaterialTheme.typography.bodyMedium,
            )
            OutlinedTextField(
                value = sheet.pin,
                onValueChange = { sheet.pin = it },
                placeholder = { Text("4-digit PIN") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            sheet.note?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
            Button(
                onClick = { vm.confirmPinOverride() },
                enabled = !sheet.checking && sheet.pin.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Confirm collection") }
            TextButton(onClick = { vm.pinSheet = null }, modifier = Modifier.fillMaxWidth()) {
                Text("Cancel")
            }
        }
    }
}

private val DOC_TYPES = listOf("id-card" to "ID", "drivers-license" to "License", "passport" to "Passport")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DeliverSheet(vm: WorkViewModel, sheet: DeliverSheet) {
    val context = LocalContext.current
    val reqs = sheet.stop.verification?.requirements
    val proof = vm.effectiveProof(sheet.stop)

    var captureTarget by rememberSaveable { mutableStateOf(CaptureTarget.POD.name) }
    var captureFile by remember { mutableStateOf<File?>(null) }
    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val file = captureFile
        sheet.photoBusy = false
        if (ok && file != null) {
            vm.setCapturedPhoto(CaptureTarget.valueOf(captureTarget), PhotoCapture.toBase64Jpeg(file))
        }
        captureFile = null
    }

    fun capture(target: CaptureTarget) {
        captureTarget = target.name
        sheet.photoBusy = true
        val (uri, file) = PhotoCapture.newCaptureUri(context)
        captureFile = file
        takePicture.launch(uri)
    }

    ModalBottomSheet(onDismissRequest = { vm.deliverSheet = null }) {
        Column(
            Modifier
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Confirm delivery", style = MaterialTheme.typography.titleMedium)
            Text(
                "Stop #${sheet.stop.shortId} — ${sheet.stop.destination.name ?: ""}",
                style = MaterialTheme.typography.bodyMedium,
            )

            if (proof == "picture") {
                Text("PROOF PHOTO", style = MaterialTheme.typography.labelSmall)
                FilledTonalButton(
                    onClick = { capture(CaptureTarget.POD) },
                    enabled = !sheet.photoBusy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (sheet.photoBase64 != null) "📷 Retake photo (captured ✓)" else "📷 Take proof photo")
                }
            }

            if (proof == "signature") {
                Text("CUSTOMER SIGNATURE", style = MaterialTheme.typography.labelSmall)
                SignaturePad(strokes = sheet.signatureStrokes)
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Sign in the box above.", style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = { sheet.signatureStrokes.clear() }) { Text("Clear") }
                }
            }

            if (proof == "pin") {
                Text("CUSTOMER PIN", style = MaterialTheme.typography.labelSmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = sheet.pin,
                        onValueChange = { sheet.pin = it },
                        placeholder = { Text("4-digit PIN") },
                        enabled = !sheet.noPin,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.weight(1f),
                        singleLine = true,
                    )
                    FilledTonalButton(
                        onClick = { vm.checkDeliveryPin() },
                        enabled = !sheet.noPin && sheet.pin.isNotBlank() && !sheet.checking,
                    ) { Text("Check") }
                }
                if (sheet.pinChecked == "verified") {
                    Text(
                        "✓ PIN verified — hand over.",
                        color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = sheet.noPin, onCheckedChange = { sheet.noPin = it })
                    Text(
                        "Customer can't provide the PIN (will be flagged for review)",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }

            if (reqs?.minAge != null) {
                Text("AGE CHECK — ${reqs.minAge}+ ORDER", style = MaterialTheme.typography.labelSmall)
                Text(
                    "Check the customer's ID: born ${Year.now().value - reqs.minAge} or earlier.",
                    style = MaterialTheme.typography.bodySmall,
                )
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    DOC_TYPES.forEachIndexed { i, (value, label) ->
                        SegmentedButton(
                            selected = sheet.ageMethod == "id-attestation" && sheet.docType == value,
                            onClick = {
                                sheet.ageMethod = "id-attestation"
                                sheet.docType = value
                            },
                            shape = SegmentedButtonDefaults.itemShape(index = i, count = DOC_TYPES.size),
                        ) { Text(label) }
                    }
                }
                if (reqs.ageVisualOverrideAllowed == true) {
                    if (sheet.ageMethod == "visual-override") {
                        Button(
                            onClick = {},
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Visibly well over ${reqs.minAge} — no ID checked") }
                    } else {
                        OutlinedButton(
                            onClick = { sheet.ageMethod = "visual-override" },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Visibly well over ${reqs.minAge} — no ID checked") }
                    }
                }
                // Client policy: PHOTOGRAPH the government ID — only for the
                // id-attestation path.
                if (vm.drawerIdPhotoRequired(sheet) && sheet.ageMethod == "id-attestation") {
                    FilledTonalButton(
                        onClick = { capture(CaptureTarget.ID) },
                        enabled = !sheet.photoBusy,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            if (sheet.idPhotoBase64 != null) "🪪 Retake ID photo (captured ✓)"
                            else "🪪 Photograph the ID (required)",
                        )
                    }
                }
            }

            sheet.note?.let {
                Text(
                    it,
                    color = if (sheet.pinChecked == "mismatch") MaterialTheme.colorScheme.error
                    else MaterialTheme.colorScheme.tertiary,
                    style = MaterialTheme.typography.bodySmall,
                )
            }

            Button(
                onClick = { vm.confirmDeliver(signaturePngBase64(sheet.signatureStrokes.toList())) },
                enabled = vm.canDeliver(sheet) && vm.reportBusy != sheet.stop.orderId,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    if (sheet.pinChecked == "mismatch") "Deliver anyway (flagged)" else "Confirm delivered",
                )
            }
            TextButton(onClick = { vm.deliverSheet = null }, modifier = Modifier.fillMaxWidth()) {
                Text("Cancel")
            }
        }
    }
}

@Composable
private fun FailDialog(vm: WorkViewModel, trip: MyTrip, stop: MyTripStop) {
    var reason by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = { vm.failDialogStop = null },
        title = { Text("Failed delivery") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Why did this delivery fail?")
                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = {
                vm.failStop(trip, stop, reason)
                vm.failDialogStop = null
            }) { Text("Fail stop") }
        },
        dismissButton = {
            TextButton(onClick = { vm.failDialogStop = null }) { Text("Cancel") }
        },
    )
}
