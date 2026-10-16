/*
 * Crate — script de contrôleur Bitwig piloté par Crate (OSC sur UDP, localhost).
 * Rôle : Espace dans Crate lance ou arrête le transport de Bitwig, sans frappe simulée.
 *
 * Entrée : serveur OSC UDP sur le port 9070 (Crate → Bitwig)
 *   /crate/toggle   lecture / arrêt du transport
 *   /crate/ping     Bitwig répond par /crate/state
 * Sortie : OSC UDP vers 127.0.0.1:9071 (Bitwig → Crate)
 *   /crate/state i  1 = lecture, 0 = arrêt ; à chaque changement du transport et en réponse à /crate/ping
 *
 * Aucun port MIDI. Copié par Crate (Réglages › From the DAW › Install Bitwig script), puis ajouté une fois dans
 * Bitwig : Settings › Controllers › Add controller manually › Crate › Crate.
 * Source de vérité : bitwig/Crate.control.js dans le dépôt de Crate (embarqué dans l'app).
 */

loadAPI(24);

host.setShouldFailOnDeprecatedUse(false);
host.defineController("Crate", "Crate", "1.0", "8f79e8a3-e78e-4c4b-ad9b-0ea14d224e61", "Crate");
host.defineMidiPorts(0, 0);

var IN_PORT = 9070;
var OUT_HOST = "127.0.0.1";
var OUT_PORT = 9071;

var out = null;
var transport = null;

// sendMessage attend un tableau Java d'arguments : l'appel variadique est tenté d'abord, le tableau ensuite.
function send(addr) {
   if (!out) return;
   var args = Array.prototype.slice.call(arguments, 1);
   var conv = [];
   for (var i = 0; i < args.length; i++) conv.push(toOscArg(args[i]));
   try {
      out.sendMessage.apply(out, [addr].concat(conv));
   } catch (e) {
      try {
         var arr = new (Java.type("java.lang.Object[]"))(conv.length);
         for (var j = 0; j < conv.length; j++) arr[j] = conv[j];
         out.sendMessage(addr, arr);
      } catch (e2) {
         host.errorln("send failed " + addr + ": " + e + " / " + e2);
      }
   }
}

// Entiers en java.lang.Integer : argument OSC « i » (Crate lit aussi « f » et « d »).
function toOscArg(v) {
   if (typeof v === "boolean") return java.lang.Integer.valueOf(v ? 1 : 0);
   if (typeof v === "number") {
      try { return java.lang.Integer.valueOf(Math.round(v)); } catch (e) { return v; }
   }
   return String(v);
}

function sendState() {
   send("/crate/state", transport && transport.isPlaying().get() ? 1 : 0);
}

function init() {
   transport = host.createTransport();
   transport.isPlaying().markInterested();
   transport.isPlaying().addValueObserver(function (playing) {
      send("/crate/state", playing ? 1 : 0);
   });

   var osc = host.getOscModule();
   var space = osc.createAddressSpace();
   space.setShouldLogMessages(false);
   space.registerDefaultMethod(function (source, message) {
      try {
         dispatch(message.getAddressPattern());
      } catch (e) {
         host.errorln("Crate: " + message.getAddressPattern() + ": " + e);
      }
   });
   osc.createUdpServer(IN_PORT, space);
   out = osc.connectToUdpServer(OUT_HOST, OUT_PORT, null);

   host.scheduleTask(sendState, 500);
   host.println("Crate ready: listening on UDP " + IN_PORT + ", replying to " + OUT_HOST + ":" + OUT_PORT);
}

function dispatch(address) {
   if (address === "/crate/toggle") transport.togglePlay();
   else if (address === "/crate/ping") sendState();
}

function flush() { }

function exit() {
   host.println("Crate exit");
}
