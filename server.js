import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

const String erraAutoLeadBaseUrl = 'https://github-vbyhnc.helipod.app/';

/// Hasil ekstraksi dari chat WhatsApp untuk satu nomor pelanggan.
class WaLeadInfo {
  final String? name;
  final String? need; // kebutuhan
  final String? budget;
  final String? laptopReference; // referensi laptop (opsional)

  const WaLeadInfo({this.name, this.need, this.budget, this.laptopReference});

  factory WaLeadInfo.fromJson(Map<String, dynamic> j) => WaLeadInfo(
        name: j['name']?.toString(),
        need: j['need']?.toString(),
        budget: j['budget']?.toString(),
        laptopReference: j['laptopReference']?.toString(),
      );
}

/// Service yang bisa dipakai juga oleh halaman "Tambah Lead".
class ErraAutoLeadService {
  static Uri _uri(String path) => Uri.parse('$erraAutoLeadBaseUrl$path');

  static Future<Map<String, String>> headers() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      throw Exception('Sesi login sudah berakhir. Silakan login ulang.');
    }
    final token = await user.getIdToken();
    return {
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  /// 0812xxx / +62812xxx / 62812xxx -> 62812xxx
  static String normalizePhone(String input) {
    var p = input.replaceAll(RegExp(r'[^0-9]'), '');
    if (p.startsWith('0')) p = '62${p.substring(1)}';
    return p;
  }

  /// Cari data lead dari chat WhatsApp yang tertaut berdasarkan nomor.
  /// Mengembalikan null jika nomor tidak ada di chat WA yang tertaut.
  ///
  /// CATATAN: endpoint ini asumsi saya. Sesuaikan dengan backend Anda:
  /// GET /api/sessions/{uid}/leads/lookup?phone=62812...
  /// respons: {"ok": true, "lead": {"name","need","budget","laptopReference"}}
  static Future<WaLeadInfo?> lookupByPhone(String phone) async {
    final uid = FirebaseAuth.instance.currentUser!.uid;
    final normalized = normalizePhone(phone);
    if (normalized.length < 8) return null;
    final response = await http.get(
      _uri('/api/sessions/${Uri.encodeComponent(uid)}/leads/lookup?phone=$normalized'),
      headers: await headers(),
    );
    if (response.statusCode == 404) return null;
    final decoded = jsonDecode(response.body);
    if (decoded is! Map<String, dynamic> ||
        response.statusCode < 200 ||
        response.statusCode >= 300 ||
        decoded['ok'] != true ||
        decoded['lead'] is! Map) {
      return null;
    }
    return WaLeadInfo.fromJson(Map<String, dynamic>.from(decoded['lead'] as Map));
  }
}

/*
 * CARA PAKAI DI HALAMAN TAMBAH LEAD (kode add lead Anda tidak perlu diubah banyak):
 *
 * Timer? _debounce;
 *
 * phoneController.addListener(() {
 *   _debounce?.cancel();
 *   _debounce = Timer(const Duration(milliseconds: 700), () async {
 *     try {
 *       final info = await ErraAutoLeadService.lookupByPhone(phoneController.text);
 *       if (info == null || !mounted) return;
 *       // isi hanya field yang masih kosong, supaya ketikan manual tidak tertimpa
 *       if (nameController.text.isEmpty && info.name != null) nameController.text = info.name!;
 *       if (needController.text.isEmpty && info.need != null) needController.text = info.need!;
 *       if (budgetController.text.isEmpty && info.budget != null) budgetController.text = info.budget!;
 *       if (laptopController.text.isEmpty && info.laptopReference != null) {
 *         laptopController.text = info.laptopReference!;
 *       }
 *     } catch (_) {}
 *   });
 * });
 */

class ErraAutoLeadPage extends StatefulWidget {
  const ErraAutoLeadPage({super.key});

  @override
  State<ErraAutoLeadPage> createState() => _ErraAutoLeadPageState();
}

class _ErraAutoLeadPageState extends State<ErraAutoLeadPage> {
  static const _wa = Color(0xff00A884);
  static const _waDark = Color(0xff111B21);
  static const _waGrey = Color(0xff667781);

  Timer? _timer;
  bool _loading = false;
  bool _connected = false;
  bool _hasSession = false;
  String? _phone;
  String? _qrDataUrl;
  String? _error;

  String get _uid => FirebaseAuth.instance.currentUser!.uid;
  String get _sessionPath => '/api/sessions/${Uri.encodeComponent(_uid)}';

  @override
  void initState() {
    super.initState();
    _refreshStatus();
    _timer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (mounted && !_loading) _refreshStatus(silent: true);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Uri _uri(String path) => Uri.parse('$erraAutoLeadBaseUrl$path');

  Map<String, dynamic> _decode(http.Response response) {
    final dynamic decoded = jsonDecode(response.body);
    final data = decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};
    if (response.statusCode < 200 || response.statusCode >= 300 || data['ok'] != true) {
      throw Exception(data['error']?.toString() ?? 'Request gagal (${response.statusCode})');
    }
    return data;
  }

  String _cleanError(Object e) => e.toString().replaceFirst('Exception: ', '');

  Future<void> _refreshStatus({bool silent = false}) async {
    if (erraAutoLeadBaseUrl.contains('GANTI-DENGAN-URL')) {
      if (mounted && !silent) {
        setState(() => _error = 'Isi URL backend terlebih dahulu di erra_auto_lead_page.dart.');
      }
      return;
    }
    try {
      final response = await http.get(_uri(_sessionPath), headers: await ErraAutoLeadService.headers());
      if (response.statusCode == 404) {
        if (!mounted) return;
        setState(() {
          _hasSession = false;
          _connected = false;
          _phone = null;
          _qrDataUrl = null;
          _error = null;
        });
        return;
      }
      final data = _decode(response);
      final session = Map<String, dynamic>.from(data['session'] as Map);
      if (!mounted) return;
      setState(() {
        _hasSession = true;
        _connected = session['connected'] == true;
        _phone = session['phone']?.toString();
        _error = null;
        if (_connected) _qrDataUrl = null;
      });
      if (!_connected) await _refreshQr(silent: true);
    } catch (e) {
      if (!mounted || silent) return;
      setState(() => _error = _cleanError(e));
    }
  }

  Future<void> _refreshQr({bool silent = false}) async {
    try {
      final response =
          await http.get(_uri('$_sessionPath/qr'), headers: await ErraAutoLeadService.headers());
      if (response.statusCode == 404) return;
      final data = _decode(response);
      if (!mounted) return;
      setState(() => _qrDataUrl = data['qrDataUrl']?.toString());
    } catch (e) {
      if (!mounted || silent) return;
      setState(() => _error = _cleanError(e));
    }
  }

  Future<void> _connect() async {
    if (erraAutoLeadBaseUrl.contains('GANTI-DENGAN-URL')) {
      setState(() => _error = 'Isi URL backend terlebih dahulu di erra_auto_lead_page.dart.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
      _qrDataUrl = null;
    });
    try {
      final response = await http.post(
        _uri('/api/sessions'),
        headers: await ErraAutoLeadService.headers(),
        body: jsonEncode({}),
      );
      final data = _decode(response);
      final session = Map<String, dynamic>.from(data['session'] as Map);
      if (!mounted) return;
      setState(() {
        _hasSession = true;
        _connected = session['connected'] == true;
        _phone = session['phone']?.toString();
      });
      await _refreshQr(silent: true);
      await _refreshStatus(silent: true);
    } catch (e) {
      if (mounted) setState(() => _error = _cleanError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _disconnect({required bool logout}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final suffix = logout ? '?logout=true' : '';
      final response = await http.delete(
        _uri('$_sessionPath$suffix'),
        headers: await ErraAutoLeadService.headers(),
      );
      _decode(response);
      if (!mounted) return;
      setState(() {
        _connected = false;
        _hasSession = !logout;
        _phone = null;
        _qrDataUrl = null;
      });
      if (!logout) await _refreshStatus(silent: true);
    } catch (e) {
      if (mounted) setState(() => _error = _cleanError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Uint8List? _qrBytes() {
    final value = _qrDataUrl;
    if (value == null) return null;
    final comma = value.indexOf(',');
    if (comma < 0) return null;
    try {
      return base64Decode(value.substring(comma + 1));
    } catch (_) {
      return null;
    }
  }

  Future<void> _confirmLogout() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Logout WhatsApp?'),
        content: const Text(
            'Sesi perangkat akan dihapus dari backend. Anda perlu memindai QR lagi saat menghubungkan kembali.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
          TextButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Logout dan hapus sesi')),
        ],
      ),
    );
    if (ok == true) await _disconnect(logout: true);
  }

  // ---------- UI ----------

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xffF0F2F5),
      appBar: AppBar(
        title: const Text('Tautkan WhatsApp'),
        backgroundColor: _wa,
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
              ),
              child: _connected ? _connectedView() : _linkView(),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xffFFF0F0),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(_error!, style: const TextStyle(color: Colors.red)),
              ),
            ],
            const SizedBox(height: 16),
            _infoCard(),
            if (_hasSession && !_connected) ...[
              const SizedBox(height: 8),
              TextButton(
                onPressed: _loading ? null : _confirmLogout,
                child: const Text('Logout dan hapus sesi perangkat'),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _linkView() {
    final qrBytes = _qrBytes();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Gunakan WhatsApp di aplikasi ini',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: _waDark),
        ),
        const SizedBox(height: 16),
        _step(1, 'Buka WhatsApp di HP sales'),
        _step(2, 'Ketuk Menu ⋮ (Android) atau Pengaturan (iPhone)'),
        _step(3, 'Pilih Perangkat tertaut, lalu Tautkan perangkat'),
        _step(4, 'Arahkan HP ke QR code di bawah ini'),
        const SizedBox(height: 20),
        Center(
          child: Container(
            width: 280,
            height: 280,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(0xffE9EDEF), width: 2),
            ),
            child: qrBytes != null
                ? Image.memory(qrBytes, fit: BoxFit.contain, gaplessPlayback: true)
                : Center(
                    child: _loading || _hasSession
                        ? const Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              CircularProgressIndicator(color: _wa),
                              SizedBox(height: 12),
                              Text('Menyiapkan QR...', style: TextStyle(color: _waGrey)),
                            ],
                          )
                        : const Icon(Icons.qr_code_2_rounded, size: 120, color: Color(0xffD1D7DB)),
                  ),
          ),
        ),
        const SizedBox(height: 8),
        const Center(
          child: Text(
            'QR diperbarui otomatis. Jangan bagikan QR ini ke orang lain.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.red, fontSize: 12),
          ),
        ),
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: _loading ? null : _connect,
            icon: _loading
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : Icon(_hasSession ? Icons.refresh : Icons.qr_code_scanner),
            label: Text(_loading
                ? 'Memproses...'
                : (_hasSession ? 'Muat ulang QR' : 'Tampilkan QR')),
            style: ElevatedButton.styleFrom(
              backgroundColor: _wa,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
            ),
          ),
        ),
      ],
    );
  }

  Widget _connectedView() {
    return Column(
      children: [
        const SizedBox(height: 8),
        Container(
          width: 84,
          height: 84,
          decoration: const BoxDecoration(color: Color(0xffE7FCF5), shape: BoxShape.circle),
          child: const Icon(Icons.check_rounded, color: _wa, size: 52),
        ),
        const SizedBox(height: 16),
        const Text('WhatsApp terhubung',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: _waDark)),
        if (_phone != null) ...[
          const SizedBox(height: 6),
          Text('+$_phone', style: const TextStyle(color: _waGrey, fontSize: 15)),
        ],
        const SizedBox(height: 12),
        const Text(
          'Saat menambah lead, isi nomor pelanggan dan data nama, kebutuhan, budget, serta referensi laptop akan terisi otomatis jika nomornya pernah chat.',
          textAlign: TextAlign.center,
          style: TextStyle(color: _waGrey, height: 1.4),
        ),
        const SizedBox(height: 20),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: _loading ? null : () => _disconnect(logout: false),
            icon: const Icon(Icons.link_off),
            label: const Text('Putuskan koneksi sementara'),
            style: OutlinedButton.styleFrom(
              foregroundColor: _waDark,
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
            ),
          ),
        ),
        TextButton(
          onPressed: _loading ? null : _confirmLogout,
          child: const Text('Logout dan hapus sesi perangkat', style: TextStyle(color: Colors.red)),
        ),
      ],
    );
  }

  Widget _step(int n, String text) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 24,
              height: 24,
              alignment: Alignment.center,
              decoration: const BoxDecoration(color: Color(0xffE7FCF5), shape: BoxShape.circle),
              child: Text('$n',
                  style: const TextStyle(color: _wa, fontWeight: FontWeight.w700, fontSize: 13)),
            ),
            const SizedBox(width: 12),
            Expanded(child: Text(text, style: const TextStyle(color: _waDark, height: 1.35))),
          ],
        ),
      );

  Widget _infoCard() => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
        child: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Cara kerja', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
            SizedBox(height: 8),
            Text('• Chat pribadi yang masuk diproses dengan aturan teks, bukan AI.'),
            Text('• Pesan grup, status, dan pesan yang dikirim akun sales diabaikan.'),
            Text('• Nama, kebutuhan, budget, dan referensi laptop diisi otomatis di form Tambah Lead bila nomornya ada di chat.'),
            Text('• Periksa kembali hasil ekstraksi sebelum follow-up.'),
          ],
        ),
      );
}
