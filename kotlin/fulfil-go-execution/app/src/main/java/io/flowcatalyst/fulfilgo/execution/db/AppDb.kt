package io.flowcatalyst.fulfilgo.execution.db

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Delete
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "outbox_items")
data class OutboxItem(
    @PrimaryKey val id: String,
    val endpoint: String,
    val method: String,
    val body: String?,
    val idempotencyKey: String,
    val attempts: Int,
    val nextAttemptAt: Long,
    /** pending | dead */
    val status: String,
    val lastError: String?,
    val createdAt: Long,
)

@Dao
interface OutboxDao {
    @Insert
    suspend fun insert(item: OutboxItem)

    @Update
    suspend fun update(item: OutboxItem)

    @Query("DELETE FROM outbox_items WHERE id = :id")
    suspend fun remove(id: String)

    @Query(
        "SELECT * FROM outbox_items WHERE status = 'pending' AND nextAttemptAt <= :now " +
            "ORDER BY createdAt ASC LIMIT :limit",
    )
    suspend fun listDue(now: Long, limit: Int): List<OutboxItem>

    @Query("SELECT * FROM outbox_items WHERE id = :id")
    suspend fun byId(id: String): OutboxItem?

    @Query("SELECT * FROM outbox_items WHERE status = 'dead' ORDER BY createdAt ASC")
    fun dead(): Flow<List<OutboxItem>>

    @Query("SELECT COUNT(*) FROM outbox_items WHERE status = 'pending'")
    fun pendingCount(): Flow<Int>
}

@Entity(tableName = "telemetry_fixes")
data class TelemetryFix(
    @PrimaryKey val uuid: String,
    /** ISO-8601 UTC. */
    val timestamp: String,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Double?,
    val speed: Double?,
    val heading: Double?,
    val altitude: Double?,
    val isMoving: Boolean?,
    val batteryLevel: Double?,
    val batteryCharging: Boolean?,
    val createdAt: Long,
)

@Dao
interface TelemetryDao {
    @Insert
    suspend fun insert(fix: TelemetryFix)

    @Query("SELECT * FROM telemetry_fixes ORDER BY createdAt ASC LIMIT :limit")
    suspend fun oldest(limit: Int): List<TelemetryFix>

    @Delete
    suspend fun delete(fixes: List<TelemetryFix>)

    @Query("SELECT COUNT(*) FROM telemetry_fixes")
    suspend fun count(): Int
}

@Database(entities = [OutboxItem::class, TelemetryFix::class], version = 1, exportSchema = false)
abstract class AppDb : RoomDatabase() {
    abstract fun outbox(): OutboxDao
    abstract fun telemetry(): TelemetryDao

    companion object {
        @Volatile private var instance: AppDb? = null

        fun get(context: Context): AppDb = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                AppDb::class.java,
                "fulfilgo-exec.db",
            ).build().also { instance = it }
        }
    }
}
