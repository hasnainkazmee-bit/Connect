package com.sunhub.community

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Rect
import android.media.ExifInterface
import androidx.test.platform.app.InstrumentationRegistry
import com.sunhub.core.UploadFile
import java.io.File
import org.junit.Assert.*
import org.junit.Test

class PhotoCropTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun ratioAndZoomStayWithinImageBounds() {
        for (ratio in listOf(0.8f, 1f, 2.5f)) for (zoom in listOf(1f, 2f, 4f)) {
            for (x in listOf(0f, 0.5f, 1f)) for (y in listOf(0f, 0.5f, 1f)) {
                val area = PhotoCrop.bounds(1200, 1000, ratio, zoom, x, y)
                assertTrue(area.left >= 0 && area.top >= 0 && area.right <= 1200 && area.bottom <= 1000)
                assertTrue(area.width() > 0 && area.height() > 0)
                assertEquals(ratio, area.width().toFloat() / area.height(), 0.02f)
            }
        }
        assertEquals(Rect(200, 0, 1000, 1000), PhotoCrop.bounds(1200, 1000, 0.8f, 1f, 0.5f, 0.5f))
    }

    @Test fun movingCropChangesExportedPixelsAndKeepsOriginal() {
        val image = Bitmap.createBitmap(200, 100, Bitmap.Config.ARGB_8888)
        for (x in 0 until 200) for (y in 0 until 100) image.setPixel(x, y, if (x < 100) Color.RED else Color.BLUE)
        val original = File.createTempFile("crop-source", ".png", context.cacheDir)
        original.outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        val file = UploadFile(original.path, "project.png", "image/png")
        val exported = mutableListOf<UploadFile>()
        try {
            for ((focal, color) in listOf(0f to Color.RED, 1f to Color.BLUE)) {
                val adjusted = PhotoCrop.export(context, file, image, PhotoCrop.bounds(200, 100, 1f, 1f, focal, 0.5f))
                exported += adjusted
                val result = BitmapFactory.decodeFile(adjusted.path)
                assertEquals(100, result.width)
                assertEquals(100, result.height)
                assertEquals(color, result.getPixel(50, 50))
                result.recycle()
            }
            assertTrue(original.exists())
            assertFalse(image.isRecycled)
        } finally { MediaFiles.discard(exported); original.delete(); image.recycle() }
    }

    @Test fun transparentProfileCropStaysTransparent() {
        val image = Bitmap.createBitmap(100, 125, Bitmap.Config.ARGB_8888)
        image.eraseColor(Color.TRANSPARENT)
        image.setPixel(50, 62, Color.YELLOW)
        val adjusted = PhotoCrop.export(context, UploadFile("unused", "logo.png", "image/png"), image, Rect(0, 0, 100, 125))
        try {
            val result = BitmapFactory.decodeFile(adjusted.path)
            assertEquals("image/png", adjusted.mime)
            assertEquals(0, Color.alpha(result.getPixel(0, 0)))
            assertEquals(Color.YELLOW, result.getPixel(50, 62))
            result.recycle()
        } finally { MediaFiles.discard(listOf(adjusted)); image.recycle() }
    }

    @Test fun exportBoundsResolutionWithoutChangingAspect() {
        val image = Bitmap.createBitmap(2560, 1280, Bitmap.Config.ARGB_8888)
        image.eraseColor(Color.BLUE)
        val adjusted = PhotoCrop.export(context, UploadFile("unused", "project.png", "image/png"), image, Rect(0, 0, 2560, 1280))
        try {
            val result = BitmapFactory.decodeFile(adjusted.path)
            assertEquals(2048, result.width)
            assertEquals(1024, result.height)
            result.recycle()
        } finally { MediaFiles.discard(listOf(adjusted)); image.recycle() }
    }

    @Test fun decoderRespectsCameraOrientation() {
        val file = File.createTempFile("camera-orientation", ".jpg", context.cacheDir)
        val image = Bitmap.createBitmap(40, 20, Bitmap.Config.ARGB_8888)
        image.eraseColor(Color.RED)
        file.outputStream().use { image.compress(Bitmap.CompressFormat.JPEG, 95, it) }
        image.recycle()
        try {
            ExifInterface(file.path).apply {
                setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_ROTATE_90.toString())
                saveAttributes()
            }
            val decoded = PhotoCrop.decode(file)
            assertEquals(20, decoded.width)
            assertEquals(40, decoded.height)
            decoded.recycle()
        } finally { file.delete() }
    }
}
