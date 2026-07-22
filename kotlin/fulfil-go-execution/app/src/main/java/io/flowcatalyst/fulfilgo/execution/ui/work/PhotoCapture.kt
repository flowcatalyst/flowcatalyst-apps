package io.flowcatalyst.fulfilgo.execution.ui.work

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.ByteArrayOutputStream
import java.io.File
import android.util.Base64 as AndroidBase64

/**
 * System-camera capture target + downscale pipeline — parity with the
 * Capacitor Camera call (width 1280, JPEG quality 55, base64 no prefix).
 */
object PhotoCapture {
    private const val MAX_DIM = 1280
    private const val JPEG_QUALITY = 55

    fun newCaptureUri(context: Context): Pair<Uri, File> {
        val dir = File(context.cacheDir, "camera").apply { mkdirs() }
        val file = File.createTempFile("capture_", ".jpg", dir)
        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            file,
        )
        return uri to file
    }

    fun toBase64Jpeg(file: File): String? {
        if (!file.exists() || file.length() == 0L) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_DIM) sample *= 2
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        val decoded = BitmapFactory.decodeFile(file.absolutePath, options) ?: return null
        val scale = minOf(1f, MAX_DIM.toFloat() / maxOf(decoded.width, decoded.height))
        val bitmap = if (scale < 1f) {
            Bitmap.createScaledBitmap(
                decoded,
                (decoded.width * scale).toInt(),
                (decoded.height * scale).toInt(),
                true,
            )
        } else {
            decoded
        }
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
        file.delete()
        return AndroidBase64.encodeToString(out.toByteArray(), AndroidBase64.NO_WRAP)
    }
}
