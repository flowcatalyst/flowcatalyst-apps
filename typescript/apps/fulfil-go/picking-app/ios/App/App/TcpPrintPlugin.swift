import Foundation
import Capacitor
import Network

/**
 * In-repo raw-TCP label delivery (docs/bag-label-printing.md): one write of
 * server-rendered ZPL to the store printer's :9100. Registered by
 * PickingViewController (local plugins aren't auto-discovered on iOS).
 * Requires NSLocalNetworkUsageDescription (Info.plist) on first use.
 */
@objc(TcpPrintPlugin)
public class TcpPrintPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TcpPrintPlugin"
    public let jsName = "TcpPrint"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "io.flowcatalyst.fulfilgo.picking.tcp-print")

    @objc func send(_ call: CAPPluginCall) {
        guard let host = call.getString("host"), !host.isEmpty,
              let dataBase64 = call.getString("dataBase64"),
              let payload = Data(base64Encoded: dataBase64) else {
            call.reject("host and dataBase64 are required")
            return
        }
        let port = call.getInt("port") ?? 9100
        guard port > 0, port <= 65535, let nwPort = NWEndpoint.Port(rawValue: UInt16(port)) else {
            call.reject("invalid port")
            return
        }

        let connection = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: .tcp)
        var completed = false
        let finish: (String?) -> Void = { error in
            guard !completed else { return }
            completed = true
            connection.cancel()
            if let error = error { call.reject(error) } else { call.resolve() }
        }

        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                connection.send(content: payload, completion: .contentProcessed { err in
                    finish(err.map { "print failed: \($0.localizedDescription)" })
                })
            case .failed(let err):
                finish("connect failed: \(err.localizedDescription)")
            case .waiting(let err):
                // .waiting retries forever — a wrong IP should fail fast.
                finish("printer unreachable: \(err.localizedDescription)")
            default:
                break
            }
        }
        queue.asyncAfter(deadline: .now() + 6) { finish("print timed out") }
        connection.start(queue: queue)
    }
}
