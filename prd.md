PRODUCT REQUIREMENT DOCUMENT (PRD)
Spesifikasi Pengembangan Game 2D Battle Royale Offline berbasis HTML5 Canvas
Nama Proyek: HTML5 Canvas Battle Royale (Offline)
Platform Tujuan: Mobile Web (Landscape) & Desktop Web
Teknologi: Pure HTML5, CSS3, JavaScript (Vanilla Canvas API) Versi Dokumen: 1.0.0 | Tanggal: 2026
1. Ringkasan Eksekutif & Tujuan Proyek
Dokumen ini dirancang sebagai panduan arsitektur dan persyaratan teknis untuk membangun game 2D Top-Down Battle
Royale berbasis web tanpa dependensi framework eksternal (menggunakan murni HTML5 Canvas, CSS3, dan Vanilla
JavaScript). Game ini beroperasi secara 100% offline dengan menyimulasikan 10–20 bot AI cerdas dalam satu peta arena. 
Game dirancang responsif lintas perangkat, mendukung skenario penggunaan Desktop (Navigasi Keyboard WASD +
Bidikan Mouse) dan Mobile Smartphone (Orientasi Paksa Landscape dengan Overlay Virtual Touch Controller). 
Sasaran Utama Pengembang
Menyediakan game arcade ringan, tidak membutuhkan server backend, hemat sumber daya memori, serta dapat diakses
langsung via browser file HTML lokal maupun hosting statis sederhana. 
2. Spesifikasi Platform & Kebutuhan Antarmuka Perangkat
MOBILE Orientasi & Kontrol Touch
• 
• 
• 
• 
Orientasi Layar: Harus mengunci orientasi 
Landscape. Jika dibuka dalam mode Portrait,
tampilkan overlay peringatan untuk memutar layar.
JoyStick Analog Virtual (Kiri): Mengendalikan arah
pergerakan karakter (360 derajat).
Tombol Tembak (Kanan): Tombol bulat besar untuk
menembak ke arah pergerakan/bidikan.
Tombol Aksi (Kanan Atas/Bawah): Tombol Reload,
Use Medkit, dan Pick Up Item.
DESKTOP Keyboard & Mouse
• 
• 
• 
• 
Gerakan Karakter: Tombol W (Atas), A (Kiri), S
(Bawah), D (Kanan).
Bidikan (Aiming): Karakter selalu menghadap ke
posisi kursor mouse di dalam Canvas.
Tembakan (Fire): Klik Kiri Mouse (Left Click).
Interaksi & Item: Tombol R (Reload), E (Ambil Loot), 
F (Gunakan Medkit), 1-3 (Ganti Senjata).
3. Arsitektur Mekanisme Permainan (Core Gameplay Mechanics)
3.1. Fase Permainan (Game Flow Cycle)
1. 
2. 
3. 
4. 
5. 
6. 
Main Menu: Pemain menekan tombol "Start Game" dan memilih jumlah musuh bot (misal: 10, 15, atau 20 Bot).
Spawning (Pendaratan/Spawn Random): Pemain dan seluruh bot di-spawn secara acak di titik-titik koordinat peta
tanpa senjata awal (tangan kosong).
Looting Phase: Pemain dan bot menjelajahi peta untuk mencari senjata, peluru, armor, dan item medis.
Shrinking Safe Zone (Zona Penyusutan): Lingkaran aman (Safe Zone / White Circle) dan lingkaran radiasi (Danger
Zone / Blue Ring) akan mengecil bertahap berdasarkan interval waktu.
Pertempuran (Combat & AI Elimination): Kontak senjata antar pemain dan bot. Pemain/bot yang kehabisan HP akan
mati dan menjatuhkan loot crate.
Kondisi Menang/Kalah: Permainan berakhir jika Pemain menjadi satu-satunya yang tersisa (Chicken Dinner / Victory)
atau jika HP Pemain mencapai 0 (Defeated / Game Over).
Dokumen Persyaratan Produk (PRD) - HTML5 Offline Battle Royale
Halaman 1 dari 4
3.2. Spesifikasi Senjata & Item (Loot Engine)
Kategori
Pistol
Rifle
Shotgun
Medis
Armor
Nama Item
P92
Handgun
AK-47 /
M416
S12K
First Aid Kit
Kevlar Vest
Damage
18 HP
32 HP
70 HP (Point
Blank)
+50 HP
Reduksi Damage
30%
Kapasitas
Magazin
12 Peluru
30 Peluru
5 Peluru
Maks 3 item
Daya tahan 100
HP
Jarak
Tembak
Sedang
(300px)
Jauh (550px)
Dekat
(150px)--
4. Logika AI Bot (Artificial Intelligence Behavior FSM)
Karakteristik Senjata
Tembakan tunggal, fire rate sedang.
Otomatis beruntun, damage tinggi.
Sebaran peluru (spread), sangat mematikan
di jarak dekat.
Membutuhkan durasi pemakaian 3 detik
(berhenti bergerak).
Mengurangi jumlah damage fisik yang
diterima.
Untuk memberikan tantangan offline yang realistis, AI Bot dikendalikan menggunakan sistem Finite State Machine (FSM)
dengan 4 status utama: 
Status AI
WANDER / LOOT
MOVE TO ZONE
ATTACK / COMBAT
RETREAT / HEAL
Pemicu (Trigger)
Tidak ada musuh terlihat & Zona aman.
Waktu countdown zona habis & Bot berada
di luar lingkaran aman.
Melihat Pemain atau Bot lain dalam jarak
pandang (Line of Sight ≤ 400px).
HP Bot di bawah 25% dan memiliki item
medis.
Tindakan Bot
Bergerak secara acak menuju item loot terdekat di
canvas. Memungut senjata/peluru.
Menghentikan pertempuran sekunder dan berlari
langsung ke titik tengah Safe Zone terkini.
Berhenti sejenak, mengarahkan rotasi ke target,
menembakkan senjata berulang kali.
Mencari penutup/berlari menjauh dari musuh untuk
mengonsumsi item medkit.
5. Antarmuka Pengguna & HUD (Head-Up Display)
Overlay HUD dibuat menggunakan kombinasi tag HTML absolut di atas elemen <canvas>:
• 
• 
• 
• 
• 
Status Kesehatan (HP Bar): Bilah warna hijau (100–51 HP), kuning (50–21 HP), merah (20–0 HP) di pojok kiri bawah.
Indikator Senjata & Peluru: Menampilkan gambar ikon senjata aktif, amunisi tersisa/cadangan, dan tombol reload.
Penghitung Sisa Pemain (Alive Counter): Angka besar di pojok kanan atas yang menunjukkan jumlah entitas yang
masih hidup (misal: ALIVE: 14 / 20).
Minimap (Radar): Lingkaran kecil di pojok kanan atas menampilkan posisi relatif pemain, garis tepi Safe Zone, dan
batasan zonanya.
Notifikasi Eliminasi (Kill Feed): Teks singkat di pojok kiri atas (contoh: "Bot_03 tereliminasi oleh Pemain").
6. Struktur Kode & File Proyek (Pure HTML5 Stack)
Seluruh sistem dapat dijalankan hanya dengan 3 file utama tanpa butuh proses kompilasi (Zero-Build Step):
Dokumen Persyaratan Produk (PRD) - HTML5 Offline Battle Royale
Halaman 2 dari 4
br-game-offline/
├── index.html        # Struktur UI, Overlay Touch Kontrol, Canvas Element
├── style.css         # CSS Flexbox/Absolute Layout, Mobile Orientation Lock, HUD Styles
└── game.js           # Game Engine Logic (Canvas Loop, Physics, AI State, Touch/Keyboard Listeners)
6.1. Contoh Potongan Logika Kunci pada JavaScript (HTML5 Canvas Engine)
// Inisialisasi Game Canvas & Input Event Listener
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
// Deteksi Otomatis Input Touch (Mobile) vs Mouse (Desktop)
let isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
if (isMobile) {
    document.getElementById('mobileControls').style.display = 'block';
    setupTouchJoysticks();
} else {
    document.getElementById('mobileControls').style.display = 'none';
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleShoot);
}
// Game Loop Inti (60 FPS)
function gameLoop() {
    updatePhysics();     // Perbarui pergerakan pemain, bot, peluru, dan zona
    updateAI();          // Perbarui FSM logika bot
    renderCanvas();      // Render ulang background, item, karakter, dan efek
    requestAnimationFrame(gameLoop);
}
7. Matriks Pengujian & Verifikasi Kualitas (QA Checklist)
Kategori
Pengujian Kriteria Kelulusan (Pass Criteria) Metode Pengujian
Layar Landscape
Mobile
Tampilan secara otomatis memenuhi layar (Fullscreen Canvas) dalam
posisi miring. Peringatan rotasi muncul jika diputar vertikal.
Buka via browser Chrome Mobile /
Safari iOS di Smartphone Android/
iPhone.
Kinerja Frame
Rate
Game berjalan stabil pada 50 - 60 FPS tanpa lag atau memori bocor
(memory leak) saat 15 bot aktif bertempur.
DevTools Performance Monitor /
Chrome FPS Meter.
Kontrol Sentuh &
Keyboard
Joystick virtual merespons gerakan multi-touch tanpa bentrok saat
menekan tombol tembak secara bersamaan. Kontrol WASD & Klik
Mouse berfungsi presisi di PC.
Uji coba input multi-touch (2 jari
bersamaan) pada layar HP &
Keyboard PC.
Mekanik Offline Game dapat dimainkan 100% tanpa jaringan internet (Mode Pesawat /
Airplane Mode aktif).
Matikan seluruh akses Wi-Fi dan data
seluler pada perangkat.
Dokumen Persyaratan Produk (PRD) - HTML5 Offline Battle Royale Halaman 3 dari 4
Langkah Selanjutnya Untuk Developer
Dokumen PRD ini sudah siap digunakan sebagai acuan pengembangan. Anda dapat langsung membuat file index.html, 
style.css, dan game.js sesuai dengan arsitektur yang tertera pada Bab 6 di atas. 
Dokumen Persyaratan Produk (PRD) - HTML5 Offline Battle Royale
Halaman 4 dari 4