package io.flowcatalyst.fulfilgo.execution.core

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.tokenDataStore by preferencesDataStore(name = "fulfilgo_exec_tokens")

data class StoredTokens(
    val accessToken: String,
    val refreshToken: String?,
    /** Epoch ms. */
    val expiresAt: Long,
)

/**
 * Namespaced token persistence — one namespace per auth plane ('driver',
 * 'platform'), both in a single DataStore file. Parity with the Capacitor
 * app's (unencrypted) Preferences token store.
 */
class TokenStore(private val context: Context, private val namespace: String) {
    private val keyAccess = stringPreferencesKey("$namespace.accessToken")
    private val keyRefresh = stringPreferencesKey("$namespace.refreshToken")
    private val keyExpires = longPreferencesKey("$namespace.expiresAt")

    suspend fun load(): StoredTokens? {
        val prefs = context.tokenDataStore.data.first()
        val access = prefs[keyAccess] ?: return null
        return StoredTokens(access, prefs[keyRefresh], prefs[keyExpires] ?: 0L)
    }

    suspend fun save(tokens: StoredTokens) {
        context.tokenDataStore.edit {
            it[keyAccess] = tokens.accessToken
            if (tokens.refreshToken != null) it[keyRefresh] = tokens.refreshToken
            else it.remove(keyRefresh)
            it[keyExpires] = tokens.expiresAt
        }
    }

    suspend fun clear() {
        context.tokenDataStore.edit {
            it.remove(keyAccess)
            it.remove(keyRefresh)
            it.remove(keyExpires)
        }
    }

    val isPresent = context.tokenDataStore.data.map { it[keyAccess] != null }
}
