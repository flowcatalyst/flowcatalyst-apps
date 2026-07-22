package io.flowcatalyst.fulfilgo.execution.ui.work

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.Canvas as ComposeCanvas
import androidx.compose.ui.graphics.Path as ComposePath
import java.io.ByteArrayOutputStream
import android.util.Base64 as AndroidBase64

/** Export dimensions — same as the Vue app's canvas (600×220 PNG). */
private const val EXPORT_W = 600f
private const val EXPORT_H = 220f

/**
 * Plain drag-to-draw signature pad. Strokes are stored normalized to the
 * 600×220 export viewport so rendering is size-independent.
 */
@Composable
fun SignaturePad(
    strokes: MutableList<List<Pair<Float, Float>>>,
    modifier: Modifier = Modifier,
) {
    val current = remember { mutableStateListOf<Pair<Float, Float>>() }

    ComposeCanvas(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(EXPORT_W / EXPORT_H)
            .clip(RoundedCornerShape(12.dp))
            .background(Color.White)
            .border(2.dp, Color(0xFFCBD5E1), RoundedCornerShape(12.dp))
            .pointerInput(Unit) {
                detectDragGestures(
                    onDragStart = { offset ->
                        current.clear()
                        current.add(toViewport(offset, size.width.toFloat(), size.height.toFloat()))
                    },
                    onDrag = { change, _ ->
                        change.consume()
                        current.add(
                            toViewport(change.position, size.width.toFloat(), size.height.toFloat()),
                        )
                    },
                    onDragEnd = {
                        if (current.size > 1) strokes.add(current.toList())
                        current.clear()
                    },
                    onDragCancel = {
                        if (current.size > 1) strokes.add(current.toList())
                        current.clear()
                    },
                )
            },
    ) {
        val scaleX = size.width / EXPORT_W
        val scaleY = size.height / EXPORT_H
        val all = strokes.toList() + if (current.size > 1) listOf(current.toList()) else emptyList()
        for (stroke in all) {
            val path = ComposePath()
            stroke.forEachIndexed { i, (x, y) ->
                if (i == 0) path.moveTo(x * scaleX, y * scaleY) else path.lineTo(x * scaleX, y * scaleY)
            }
            drawPath(
                path,
                Color(0xFF102A43),
                style = Stroke(width = 3f * scaleX, cap = StrokeCap.Round, join = StrokeJoin.Round),
            )
        }
    }
}

private fun toViewport(offset: Offset, width: Float, height: Float): Pair<Float, Float> =
    (offset.x / width * EXPORT_W) to (offset.y / height * EXPORT_H)

/** Render captured strokes to the 600×220 PNG the server evidence expects. */
fun signaturePngBase64(strokes: List<List<Pair<Float, Float>>>): String? {
    if (strokes.isEmpty()) return null
    val bitmap = Bitmap.createBitmap(EXPORT_W.toInt(), EXPORT_H.toInt(), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint().apply {
        color = android.graphics.Color.rgb(0x10, 0x2A, 0x43)
        strokeWidth = 3f
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        isAntiAlias = true
    }
    for (stroke in strokes) {
        val path = Path()
        stroke.forEachIndexed { i, (x, y) ->
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        canvas.drawPath(path, paint)
    }
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
    return AndroidBase64.encodeToString(out.toByteArray(), AndroidBase64.NO_WRAP)
}
