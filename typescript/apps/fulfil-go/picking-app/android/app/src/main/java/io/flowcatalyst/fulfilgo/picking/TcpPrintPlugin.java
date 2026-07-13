package io.flowcatalyst.fulfilgo.picking;

import android.util.Base64;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * In-repo raw-TCP label delivery (docs/bag-label-printing.md): one write of
 * server-rendered ZPL to the store printer's :9100. Serialized on a single
 * worker so labels never interleave on the wire.
 */
@CapacitorPlugin(name = "TcpPrint")
public class TcpPrintPlugin extends Plugin {

  private static final int CONNECT_TIMEOUT_MS = 4000;

  private final ExecutorService executor = Executors.newSingleThreadExecutor();

  @PluginMethod
  public void send(PluginCall call) {
    String host = call.getString("host");
    Integer port = call.getInt("port", 9100);
    String dataBase64 = call.getString("dataBase64");
    if (host == null || host.isEmpty() || dataBase64 == null || dataBase64.isEmpty()) {
      call.reject("host and dataBase64 are required");
      return;
    }
    final byte[] payload;
    try {
      payload = Base64.decode(dataBase64, Base64.DEFAULT);
    } catch (IllegalArgumentException e) {
      call.reject("dataBase64 is not valid base64");
      return;
    }
    final int targetPort = port != null ? port : 9100;
    executor.execute(() -> {
      try (Socket socket = new Socket()) {
        socket.connect(new InetSocketAddress(host, targetPort), CONNECT_TIMEOUT_MS);
        OutputStream out = socket.getOutputStream();
        out.write(payload);
        out.flush();
        call.resolve();
      } catch (Exception e) {
        call.reject("print failed: " + e.getMessage());
      }
    });
  }
}
