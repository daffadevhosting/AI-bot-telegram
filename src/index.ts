// src/index.ts
// Bot Telegram untuk toko masker bordir As-Syariah Bordir
// Fitur: Katalog produk, keranjang multi-item, Midtrans Snap, dan AI percakapan.

export interface Env {
  BOT_TOKEN: string;           // Secret: token bot Telegram
  AI: any;                     // Workers AI binding
  DB: D1Database;              // D1 database untuk menyimpan pesanan
  ORDER_SESSION: KVNamespace;  // KV namespace untuk sesi pemesanan & keranjang belanja
  PRODUCTS_URL: string;        // URL JSON produk (dari vars)
  MIDTRANS_SERVER_KEY: string; // Secret: Server Key Midtrans
  MIDTRANS_IS_PRODUCTION?: string;
  ADMIN_CHAT_ID: string;       // ID Chat Telegram Admin untuk notifikasi pesanan masuk & sukses
  ADMIN_DASHBOARD_KEY: string;
  ADMIN_ENCRYPTION_KEY: string;
  ASSETS: Fetcher;
}

// Tipe data produk sesuai struktur JSON
interface Product {
  title: string;
  slug: string;
  id: string;
  category: string;
  url: string;
  sku: string;
  price: string;
  discount: string;
  stok: string;
  description: string;
  narrative: string;
  image: string;
  styles: Style[];
}

interface Style {
  name: string;
  color: string; // representasi hex atau nama warna (misal: "Merah", "Hijau")
  image_path: string;
}

// Tipe update dari Telegram
interface TelegramUpdate {
  message?: {
    message_id: number;
    from: { id: number; first_name?: string; username?: string };
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; username?: string };
    message: {
      message_id: number;
      chat: { id: number };
    };
    data: string;
  };
}

// Item di dalam keranjang belanja
interface CartItem {
  sku: string;
  title: string;
  variant: string; 
  price: number;
  quantity: number;
}

// Struktur data keranjang belanja per pengguna
interface Cart {
  items: CartItem[];
}

// Sesi alur pengisian data saat checkout
interface OrderSession {
  step: 'awaiting_address' | 'processing_payment';
  address?: string;
}

// Helper untuk mencocokkan nama warna dengan Emoji lingkaran warna di Telegram
function getColorEmoji(colorName: string): string {
  const name = colorName.toLowerCase();
  if (name.includes('merah')) return '🔴';
  if (name.includes('biru')) return '🔵';
  if (name.includes('hijau')) return '🟢';
  if (name.includes('kuning')) return '🟡';
  if (name.includes('hitam')) return '⚫';
  if (name.includes('putih')) return '⚪';
  if (name.includes('oranye') || name.includes('jingga')) return '🟠';
  if (name.includes('ungu')) return '🟣';
  if (name.includes('cokelat') || name.includes('coklat')) return '🟤';
  if (name.includes('pink') || name.includes('merah muda')) return '🌸';
  return '🎨'; // Default emoji jika tidak ada kecocokan nama warna dasar
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Endpoint notifikasi pembayaran Midtrans.
    if (request.method === 'POST' && url.pathname === '/webhook/midtrans') {
      return await handleMidtransWebhook(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/chat') {
      return await handleWebChat(request, env);
    }

    if (url.pathname.startsWith('/api/admin/')) {
      return handleAdminApi(request, env, url);
    }

    if (request.method === 'GET') {
      if (url.pathname === '/') {
        const forbiddenPage = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url)));
        return new Response(forbiddenPage.body, {
          status: 403,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
        });
      }
      if (url.pathname === '/admin') {
        return env.ASSETS.fetch(new Request(new URL('/admin.html', request.url)));
      }
      return env.ASSETS.fetch(request);
    }

    // Hanya terima POST dari webhook Telegram pada root path
    if (request.method !== 'POST') return new Response('OK', { status: 200 });

    try {
      const update: TelegramUpdate = await request.json();
      const chatId = update.message?.chat?.id;
      const text = update.message?.text;
      const callback = update.callback_query;

      // Ambil data username & simpan ke KV untuk kebutuhan pemesanan
      if (update.message?.from) {
        const fromUser = update.message.from;
        const username = fromUser.username ? `@${fromUser.username}` : (fromUser.first_name || 'Customer');
        await env.ORDER_SESSION.put(`user_${fromUser.id}`, username, { expirationTtl: 86400 });
      }

      // Handle callback query (tombol inline)
      if (callback) {
        if (callback.from) {
          const username = callback.from.username ? `@${callback.from.username}` : 'Customer';
          await env.ORDER_SESSION.put(`user_${callback.from.id}`, username, { expirationTtl: 86400 });
        }
        await handleCallback(callback, env);
        return new Response('OK');
      }

      // Handle pesan teks biasa
      if (chatId) {
        if (text === '/start') {
          await sendMessage(env.BOT_TOKEN, chatId, 
            'Selamat datang di toko masker bordir *As-Syariah Bordir*! 🌸\n\n' +
            'Kini kamu bisa memasukkan beberapa produk dan varian warna yang berbeda sekaligus ke dalam keranjang belanja sebelum melakukan pembayaran!\n\n' +
            'Silakan gunakan perintah berikut:\n' +
            '👉 /produk - Lihat Katalog Produk (Grid View)\n' +
            '👉 /keranjang - Lihat & Atur Keranjang Belanja Anda\n' +
            '👉 /checkout - Mulai Pembayaran Aman via Midtrans\n\n' +
            'Atau kamu bisa mengobrol langsung dengan AI kami untuk bertanya seputar produk atau meminta bantuan memasukkan barang ke keranjang!'
          );
        } 
        else if (text === '/produk') {
          const products = await fetchProducts(env);
          if (!products) {
            await sendMessage(env.BOT_TOKEN, chatId, 'Gagal mengambil data produk. Silakan coba lagi nanti.');
            return new Response('OK');
          }
          
          // Menyusun Katalog Utama dalam bentuk Grid (2 Kolom) agar ringkas dan cantik
          const inline_keyboard: any[][] = [];
          for (let i = 0; i < products.length; i += 2) {
            const row: any[] = [];
            row.push({ text: `🛍️ ${products[i].title}`, callback_data: `product_${i}` });
            if (i + 1 < products.length) {
              row.push({ text: `🛍️ ${products[i + 1].title}`, callback_data: `product_${i + 1}` });
            }
            inline_keyboard.push(row);
          }
          
          const keyboard = { inline_keyboard };
          await sendMessage(env.BOT_TOKEN, chatId, 'Silakan pilih produk yang kamu inginkan dari katalog kami:', keyboard);
        }
        else if (text === '/keranjang') {
          await showCart(chatId, env);
        }
        else if (text === '/checkout') {
          await startCheckoutFlow(chatId, env);
        }
        else if (text && !text.startsWith('/')) {
          // Cek apakah pengguna sedang dalam proses mengisi alamat pengiriman (checkout)
          const sessionKey = `session_${chatId}`;
          const session = await env.ORDER_SESSION.get(sessionKey, 'json') as OrderSession | null;

          if (session && session.step === 'awaiting_address') {
            await processAddressAndCreateInvoice(chatId, text, env);
          } else {
            // Sesi normal -> chat interaktif dengan AI
            // Jalankan indikator mengetik (Typing...) di latar belakang agar pengguna tahu AI sedang berpikir
            ctx.waitUntil(sendTypingAction(env.BOT_TOKEN, chatId));
            
            const aiReply = await getAIResponse(chatId, text, env);
            await sendMessage(env.BOT_TOKEN, chatId, aiReply);
          }
        }
      }
    } catch (err: any) {
      console.error('Error handling Telegram update:', err);
    }

    return new Response('OK');
  }
};

// ===================== FUNGSI UTAMA & UTILITY =====================

// Ambil data produk dari URL remote
async function fetchProducts(env: Env): Promise<Product[] | null> {
  const url = env.PRODUCTS_URL || 'https://as-syariahbordir.github.io/product.json';
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json() as { product: Product[] };
    return data.product;
  } catch (e) {
    console.error('Fetch products error:', e);
    return null;
  }
}

// Dapatkan atau buat objek keranjang belanja pengguna dari KV
async function getCart(chatId: number, env: Env): Promise<Cart> {
  const cartKey = `cart_${chatId}`;
  const existingCart = await env.ORDER_SESSION.get(cartKey, 'json') as Cart | null;
  if (existingCart && Array.isArray(existingCart.items)) {
    return existingCart;
  }
  return { items: [] };
}

// Simpan keranjang belanja ke KV
async function saveCart(chatId: number, cart: Cart, env: Env): Promise<void> {
  const cartKey = `cart_${chatId}`;
  await env.ORDER_SESSION.put(cartKey, JSON.stringify(cart), { expirationTtl: 172800 }); // Berlaku 48 Jam
}

// Tampilkan isi keranjang belanja dengan nominal rupiah yang benar
async function showCart(chatId: number, env: Env): Promise<void> {
  const cart = await getCart(chatId, env);
  if (cart.items.length === 0) {
    await sendMessage(env.BOT_TOKEN, chatId, '🛒 Keranjang belanja Anda masih kosong. Yuk ketik /produk untuk memilih masker bordir cantik!');
    return;
  }

  let text = '🛒 *Keranjang Belanja Anda (Multi-Item):*\n\n';
  let total = 0;
  
  const inlineKeyboard: any[] = [];

  cart.items.forEach((item, idx) => {
    // Pastikan harga dikalikan kuantitas dengan benar
    const subtotal = item.price * item.quantity;
    total += subtotal;
    const emoji = getColorEmoji(item.variant);
    
    text += `*${idx + 1}. ${item.title}*\n`;
    text += `   ${emoji} Varian: _${item.variant}_\n`;
    // Menggunakan Math.round untuk memastikan tidak ada angka pecahan di belakang koma
    text += `   📦 Qty: ${item.quantity} x Rp${Math.round(item.price).toLocaleString('id-ID')} = *Rp${Math.round(subtotal).toLocaleString('id-ID')}*\n\n`;

    inlineKeyboard.push([
      { text: `➖ 1`, callback_data: `cart_adjust_minus_${idx}` },
      { text: `${emoji} x${item.quantity}`, callback_data: `none` },
      { text: `➕ 1`, callback_data: `cart_adjust_plus_${idx}` },
      { text: `❌ Hapus`, callback_data: `cart_adjust_remove_${idx}` }
    ]);
  });

  text += `⭐ *Total Keseluruhan: Rp${Math.round(total).toLocaleString('id-ID')}*`;

  inlineKeyboard.push(
    [{ text: '💳 Lanjut ke Checkout & Bayar', callback_data: 'checkout_now' }],
    [{ text: '🗑️ Kosongkan Semua Keranjang', callback_data: 'clear_cart' }],
    [{ text: '« Tambah Produk Lain', callback_data: 'back_to_list' }]
  );

  const keyboard = { inline_keyboard: inlineKeyboard };
  await sendMessage(env.BOT_TOKEN, chatId, text, keyboard);
}

// Tampilkan detail produk + pilihan varian warna dalam format GRID (2 Kolom tombol)
async function showProduct(chatId: number, product: Product, botToken: string): Promise<void> {
  const rawPrice = product.discount ? product.discount : product.price;
  const priceNumeric = parsePrice(rawPrice);
  
  let priceText = `Rp${priceNumeric.toLocaleString('id-ID')}`;
  if (product.discount) {
    const originalPriceNumeric = parsePrice(product.price);
    priceText += ` ~~Rp${originalPriceNumeric.toLocaleString('id-ID')}~~`;
  }

  const caption = `*${product.title}*\nHarga: ${priceText}\nStok: ${product.stok}\n\n${product.description}`;

  // KUNCI GRID VARIANT: Menyusun tombol varian warna dalam bentuk GRID 2 Kolom berdampingan
  const variantButtons: any[][] = [];
  for (let i = 0; i < product.styles.length; i += 2) {
    const row: any[] = [];
    
    // Varian pertama di baris ini
    const style1 = product.styles[i];
    const emoji1 = getColorEmoji(style1.name);
    row.push({ text: `${emoji1} ${style1.name}`, callback_data: `add_to_cart_${product.sku}_${i}` });
    
    // Varian kedua di baris ini (jika ada)
    if (i + 1 < product.styles.length) {
      const style2 = product.styles[i + 1];
      const emoji2 = getColorEmoji(style2.name);
      row.push({ text: `${emoji2} ${style2.name}`, callback_data: `add_to_cart_${product.sku}_${i + 1}` });
    }
    variantButtons.push(row);
  }

  const keyboard = {
    inline_keyboard: [
      ...variantButtons,
      [{ text: '🛒 Lihat Keranjang Saya', callback_data: 'view_cart' }],
      [{ text: '« Kembali ke katalog', callback_data: 'back_to_list' }]
    ]
  };

  await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: product.image,
      caption,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    })
  });
}

// Handle callback query (tombol inline)
async function handleCallback(callback: NonNullable<TelegramUpdate['callback_query']>, env: Env): Promise<void> {
  const chatId = callback.message.chat.id;
  const data = callback.data;
  const botToken = env.BOT_TOKEN;

  if (data === 'back_to_list') {
    const products = await fetchProducts(env);
    if (products) {
      // Katalog Utama juga ditampilkan dalam GRID 2 kolom biar estetik
      const inline_keyboard: any[][] = [];
      for (let i = 0; i < products.length; i += 2) {
        const row: any[] = [];
        row.push({ text: `🛍️ ${products[i].title}`, callback_data: `product_${i}` });
        if (i + 1 < products.length) {
          row.push({ text: `🛍️ ${products[i + 1].title}`, callback_data: `product_${i + 1}` });
        }
        inline_keyboard.push(row);
      }
      await sendMessage(botToken, chatId, 'Silakan pilih produk yang kamu inginkan:', { inline_keyboard });
    } else {
      await sendMessage(botToken, chatId, 'Gagal memuat daftar produk.');
    }
  } 
  else if (data.startsWith('product_')) {
    const parts = data.split('_');
    const idx = parseInt(parts[1]);
    const products = await fetchProducts(env);
    if (products && products[idx]) {
      await showProduct(chatId, products[idx], botToken);
    } else {
      await sendMessage(botToken, chatId, 'Produk tidak ditemukan.');
    }
  }
   else if (data.startsWith('add_to_cart_')) {
    const parts = data.split('_');
    const sku = parts[3];
    const variantIdx = parseInt(parts[4]);

    const products = await fetchProducts(env);
    const product = products?.find(p => p.sku === sku);

    if (product) {
      if (product.stok.toLowerCase() === 'stok habis') {
        await sendMessage(botToken, chatId, '❌ Maaf, stok produk ini sedang habis.');
      } else {
        const variant = product.styles[variantIdx];
        const cart = await getCart(chatId, env);

        const existingItem = cart.items.find(item => item.sku === sku && item.variant === variant.name);
        
        // KUNCI PERBAIKAN: Gunakan parsePrice() di sini agar angka dari JSON dibersihkan dulu
        const rawPrice = product.discount ? product.discount : product.price;
        const itemPrice = parsePrice(rawPrice);

        if (existingItem) {
          existingItem.quantity += 1;
        } else {
          cart.items.push({
            sku,
            title: product.title,
            variant: variant.name,
            price: itemPrice,
            quantity: 1
          });
        }

        await saveCart(chatId, cart, env);

        const emoji = getColorEmoji(variant.name);
        const keyboard = {
          inline_keyboard: [
            [{ text: '🛒 Lihat Keranjang', callback_data: 'view_cart' }],
            [{ text: '➕ Tambah Varian / Produk Lain', callback_data: 'back_to_list' }]
          ]
        };

        await sendMessage(botToken, chatId, `✅ Berhasil menambahkan *${product.title} (${emoji} Varian: ${variant.name})* ke keranjang belanja kamu!`, keyboard);
      }
    } else {
      await sendMessage(botToken, chatId, 'Gagal menambahkan ke keranjang, produk tidak valid.');
    }
  }
  else if (data.startsWith('cart_adjust_')) {
    // Format: cart_adjust_<minus/plus/remove>_<index>
    const parts = data.split('_');
    const action = parts[2];
    const idx = parseInt(parts[3]);
    const cart = await getCart(chatId, env);

    if (cart.items[idx]) {
      if (action === 'plus') {
        cart.items[idx].quantity += 1;
      } else if (action === 'minus') {
        cart.items[idx].quantity -= 1;
        if (cart.items[idx].quantity <= 0) {
          cart.items[idx].quantity = 0;
        }
      } else if (action === 'remove') {
        cart.items[idx].quantity = 0;
      }

      // Saring item yang sudah kosong
      cart.items = cart.items.filter(item => item.quantity > 0);
      await saveCart(chatId, cart, env);
      
      // Update tampilan keranjang terkini secara interaktif
      await showCart(chatId, env);
    }
  }
  else if (data === 'view_cart') {
    await showCart(chatId, env);
  }
  else if (data === 'clear_cart') {
    await env.ORDER_SESSION.delete(`cart_${chatId}`);
    await sendMessage(botToken, chatId, '🛒 Keranjang belanja Anda telah berhasil dikosongkan.');
  }
  else if (data === 'checkout_now') {
    await startCheckoutFlow(chatId, env);
  }

  // Selesaikan callback query agar loading di Telegram hilang
  await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callback.id })
  });
}


// Helper untuk membersihkan format string harga dari JSON menjadi angka integer murni
function parsePrice(priceStr: string): number {
  if (!priceStr) return 0;
  
  // Menghapus semua karakter non-angka kecuali jika ada format desimal asli
  // Jika di JSON tertulis "15.600", kita bersihkan titiknya agar menjadi 15600
  let cleanString = priceStr.replace(/[^0-9.-]/g, '');
  
  let price = parseFloat(cleanString);
  
  // Proteksi: Jika angka terlalu kecil (misal di bawah 1000 seperti 15.6), 
  // kemungkinan besar itu adalah salah baca format ribuan "15.600" yang terpotong.
  if (price > 0 && price < 1000) {
    price = price * 1000;
  }
  
  return price;
}

// Memulai Alur Checkout Pemesanan
async function startCheckoutFlow(chatId: number, env: Env): Promise<void> {
  const cart = await getCart(chatId, env);
  if (cart.items.length === 0) {
    await sendMessage(env.BOT_TOKEN, chatId, '🛒 Keranjang Anda kosong. Tambahkan produk ke keranjang sebelum melakukan checkout.');
    return;
  }

  // Set sesi ke status menunggu alamat pengiriman
  const sessionKey = `session_${chatId}`;
  const session: OrderSession = {
    step: 'awaiting_address'
  };
  await env.ORDER_SESSION.put(sessionKey, JSON.stringify(session), { expirationTtl: 1200 });

  await sendMessage(env.BOT_TOKEN, chatId, '🚚 Untuk melanjutkan pengiriman, mohon ketikkan *Alamat Lengkap* Anda saat ini (Nama Penerima, No. HP, Alamat Jalan, Kecamatan, Kota):');
}

// Proses alamat pengiriman dan membuat transaksi pembayaran Midtrans.
async function processAddressAndCreateInvoice(chatId: number, address: string, env: Env): Promise<void> {
  const botToken = env.BOT_TOKEN;
  const sessionKey = `session_${chatId}`;
  const cart = await getCart(chatId, env);

  if (cart.items.length === 0) {
    await sendMessage(botToken, chatId, 'Keranjang belanja kosong. Gagal memproses pesanan.');
    await env.ORDER_SESSION.delete(sessionKey);
    return;
  }

  // Mengubah status sesi menjadi sedang memproses pembayaran
  await env.ORDER_SESSION.put(sessionKey, JSON.stringify({ step: 'processing_payment', address }), { expirationTtl: 600 });
  await sendMessage(botToken, chatId, '⏳ Sedang menyiapkan tautan pembayaran aman Anda menggunakan Midtrans...');

  const username = await env.ORDER_SESSION.get(`user_${chatId}`) || `User-${chatId}`;
  const orderId = `INV-${Date.now()}-${chatId}`;
  
  // Hitung total belanjaan keseluruhan dari semua item & varian di keranjang
  const totalAmount = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  try {
    // 1. Simpan pesanan awal ke database D1 (dengan status PENDING)
    await env.DB.prepare(
      `INSERT INTO orders (id, user_id, username, total_amount, address, items, status) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      orderId, 
      chatId, 
      username, 
      totalAmount, 
      address, 
      JSON.stringify(cart.items), 
      'PENDING'
    ).run();

    // 2. Buat transaksi Snap di Midtrans.
    const midtransResponse = await createMidtransTransaction(orderId, totalAmount, username, address, cart.items, env);

    if (midtransResponse?.redirect_url) {
      const paymentUrl = midtransResponse.redirect_url;

      // Update URL Pembayaran di DB
      await env.DB.prepare(
        `UPDATE orders SET payment_url = ? WHERE id = ?`
      ).bind(paymentUrl, orderId).run();

      // Hapus Sesi Pemesanan & Keranjang
      await env.ORDER_SESSION.delete(sessionKey);
      await env.ORDER_SESSION.delete(`cart_${chatId}`);

      const msg = `🎉 *Invoice Pembayaran Berhasil Dibuat!*\n\n` +
                  `🆔 ID Transaksi: \`${orderId}\`\n` +
                  `💰 Total Belanja: *Rp${totalAmount.toLocaleString('id-ID')}*\n` +
                  `📍 Alamat Pengiriman: ${address}\n\n` +
                  `Silakan klik tombol di bawah untuk menyelesaikan pembayaran melalui Midtrans.`;

      const keyboard = {
        inline_keyboard: [
          [{ text: '💳 Bayar Sekarang', url: paymentUrl }],
          [{ text: '« Berbelanja Kembali', callback_data: 'back_to_list' }]
        ]
      };

      await sendMessage(botToken, chatId, msg, keyboard);

      // Notifikasi ke Admin bahwa ada tagihan pembayaran baru dibuat
      const adminChatId = env.ADMIN_CHAT_ID ? parseInt(env.ADMIN_CHAT_ID) : 123456789;
      const adminMsg = `🔔 *Pesanan Baru Dibuat (Multi-Item)!*\n` +
                        `🆔 ID: \`${orderId}\`\n` +
                        `👤 Pengguna: ${username} (Chat ID: ${chatId})\n` +
                        `📍 Alamat: ${address}\n` +
                        `🛍️ Item: ${cart.items.map(i => `${i.title} (${i.variant}) x${i.quantity}`).join(', ')}\n` +
                        `💰 Total: *Rp${totalAmount.toLocaleString('id-ID')}*\n` +
                        `🔗 Link Invoice: ${paymentUrl}`;
      await sendMessage(botToken, adminChatId, adminMsg);

    } else {
      throw new Error('Gagal memproses tautan pembayaran dari response Midtrans.');
    }
  } catch (error) {
    console.error('Checkout error:', error);
    await sendMessage(botToken, chatId, '❌ Terjadi masalah teknis saat memproses pembayaran Anda. Silakan coba kembali beberapa saat lagi.');
    await env.ORDER_SESSION.put(sessionKey, JSON.stringify({ step: 'awaiting_address' }), { expirationTtl: 1200 });
  }
}

// Membuat transaksi Snap Midtrans dan mengembalikan URL pembayaran.
async function createMidtransTransaction(orderId: string, amount: number, username: string, address: string, items: CartItem[], env: Env): Promise<{ redirect_url?: string } | null> {
  const baseUrl = env.MIDTRANS_IS_PRODUCTION === 'true'
    ? 'https://app.midtrans.com'
    : 'https://app.sandbox.midtrans.com';
  const midtransItems = items.map(item => ({
    name: `${item.title} (${item.variant})`,
    quantity: item.quantity,
    price: item.price,
    category: 'Masker Bordir'
  }));

  const payload = {
    transaction_details: {
      order_id: orderId,
      gross_amount: Math.round(amount)
    },
    item_details: midtransItems,
    customer_details: {
      first_name: username,
      billing_address: { address },
      shipping_address: { address }
    }
  };

  const serverKey = await getMidtransServerKey(env);
  if (!serverKey) throw new Error('Midtrans Server Key belum dikonfigurasi.');
  const token = btoa(`${serverKey}:`);

  const response = await fetch(`${baseUrl}/snap/v1/transactions`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Midtrans API error response:', errText);
    return null;
  }

  return await response.json();
}

// Handler notification Midtrans. Status diverifikasi dengan signature_key.
async function handleMidtransWebhook(request: Request, env: Env): Promise<Response> {
  try {
    const data: any = await request.json();
    const serverKey = await getMidtransServerKey(env);
    const expectedSignature = await sha512(`${data.order_id}${data.status_code}${data.gross_amount}${serverKey}`);
    if (!data.signature_key || !timingSafeEqual(data.signature_key, expectedSignature)) {
      return new Response('Invalid signature', { status: 401 });
    }

    const orderId = data.order_id;
    const status = data.transaction_status;

    if (orderId && (status === 'settlement' || (status === 'capture' && data.fraud_status === 'accept'))) {
      const order = await env.DB.prepare(
        `SELECT * FROM orders WHERE id = ?`
      ).bind(orderId).first() as { user_id: number; username: string; total_amount: number; address: string; items: string; status: string } | null;

      if (order && order.status !== 'PAID') {
        await env.DB.prepare(
          `UPDATE orders SET status = 'PAID' WHERE id = ?`
        ).bind(orderId).run();

        const parsedItems = JSON.parse(order.items) as CartItem[];
        const itemsList = parsedItems.map(i => {
          const emoji = getColorEmoji(i.variant);
          return `- *${i.title}* (${emoji} ${i.variant}) x${i.quantity}`;
        }).join('\n');
        
        const customerMsg = `✅ *PEMBAYARAN ANDA BERHASIL!* 🎉\n\n` +
                            `Halo, pembayaran untuk order \`${orderId}\` telah kami terima dengan sukses.\n\n` +
                            `📦 *Rincian Pesanan Anda:*\n${itemsList}\n` +
                            `💰 Total Pembayaran: *Rp${order.total_amount.toLocaleString('id-ID')}*\n` +
                            `📍 Alamat Pengiriman:\n${order.address}\n\n` +
                            `Tim kami sedang menyiapkan dan memproses pengiriman produk pesanan Anda. Terima kasih banyak telah mempercayakan belanja Anda di *As-Syariah Bordir*!`;
        
        await sendMessage(env.BOT_TOKEN, order.user_id, customerMsg);

        const adminChatId = env.ADMIN_CHAT_ID ? parseInt(env.ADMIN_CHAT_ID) : 123456789;
        const adminMsg = `🤑 *PEMBAYARAN PESANAN SUKSES DI TERIMA!* 🤑\n\n` +
                          `🆔 Order ID: \`${orderId}\`\n` +
                          `👤 Pembeli: ${order.username} (Chat ID: ${order.user_id})\n` +
                          `💰 Nominal: *Rp${order.total_amount.toLocaleString('id-ID')}*\n` +
                          `📍 Alamat: ${order.address}\n` +
                          `📦 Item:\n${itemsList}\n\n` +
                          `Mohon admin segera menyiapkan pengiriman produk ke alamat tersebut!`;
        
        await sendMessage(env.BOT_TOKEN, adminChatId, adminMsg);
      }
    }

    return new Response('SUCCESS', { status: 200 });
  } catch (error) {
    console.error('Error handling Midtrans Webhook:', error);
    return new Response('Webhook Error', { status: 500 });
  }
}

async function sha512(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function handleWebChat(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { messages?: Array<{ role: string; content: string }> };
    const lastUserMessage = [...(body.messages || [])].reverse().find(message => message.role === 'user')?.content;
    if (!lastUserMessage) return new Response('Missing user message', { status: 400 });

    const responseText = await getAIResponse(0, lastUserMessage, env);
    const payload = `data: ${JSON.stringify({ response: responseText })}\n\ndata: [DONE]\n\n`;
    return new Response(payload, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache'
      }
    });
  } catch (error) {
    console.error('Web chat error:', error);
    return new Response(JSON.stringify({ error: 'Chat temporarily unavailable' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handleAdminApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.ADMIN_DASHBOARD_KEY) return jsonResponse({ error: 'ADMIN_DASHBOARD_KEY belum tersedia di environment Worker.' }, 503);
  if (!isAdminAuthorized(request, env)) return jsonResponse({ error: 'Dashboard key salah.' }, 401);

  try {
    const path = url.pathname.replace('/api/admin', '') || '/';
    if (path === '/settings' && request.method === 'GET') {
      const rows = await env.DB.prepare('SELECT key, value FROM store_settings').all<{ key: string; value: string }>();
      const settings = Object.fromEntries(rows.results.map(row => [row.key, row.value]));
      return jsonResponse({
        storeName: settings.store_name || '',
        storeAddress: settings.store_address || '',
        storeLocation: settings.store_location || '',
        customerService: settings.customer_service || '',
        openingTime: settings.opening_time || '',
        closingTime: settings.closing_time || '',
        midtransClientKey: settings.midtrans_client_key || '',
        midtransServerKeyConfigured: Boolean(settings.midtrans_server_key)
      });
    }

    if (path === '/settings' && request.method === 'PUT') {
      const body = await request.json() as Record<string, string>;
      const values: Record<string, string> = {
        store_name: body.storeName || '',
        store_address: body.storeAddress || '',
        store_location: body.storeLocation || '',
        customer_service: body.customerService || '',
        opening_time: body.openingTime || '',
        closing_time: body.closingTime || '',
        midtrans_client_key: body.midtransClientKey || ''
      };
      if (body.midtransServerKey) values.midtrans_server_key = await encryptSecret(body.midtransServerKey, env.ADMIN_ENCRYPTION_KEY);
      await saveSettings(env.DB, values);
      return jsonResponse({ ok: true });
    }

    if (path === '/products' && request.method === 'GET') {
      return jsonResponse({ products: await listAdminProducts(env.DB) });
    }

    if (path === '/products' && request.method === 'POST') {
      const body = await request.json() as AdminProductInput;
      const product = await saveAdminProduct(env.DB, body);
      return jsonResponse(product, 201);
    }

    const productMatch = path.match(/^\/products\/([^/]+)$/);
    if (productMatch && request.method === 'PUT') {
      const body = await request.json() as AdminProductInput;
      return jsonResponse(await saveAdminProduct(env.DB, body, productMatch[1]));
    }
    if (productMatch && request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(productMatch[1]).run();
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: 'Not found' }, 404);
  } catch (error) {
    console.error('Admin API error:', error);
    return jsonResponse({ error: 'Request gagal diproses' }, 500);
  }
}

interface AdminProductVariant {
  color: string;
  sizeType: string;
  stock: number;
  imageUrl: string;
}

interface AdminProductInput {
  title: string;
  sku: string;
  category?: string;
  price: number;
  discount?: number;
  description?: string;
  image?: string;
  variants: AdminProductVariant[];
}

function isAdminAuthorized(request: Request, env: Env): boolean {
  const authorization = request.headers.get('Authorization');
  return authorization === `Bearer ${env.ADMIN_DASHBOARD_KEY.trim()}`;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function saveSettings(db: D1Database, values: Record<string, string>): Promise<void> {
  const statements = Object.entries(values).map(([key, value]) => db.prepare(
    `INSERT INTO store_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, value));
  await db.batch(statements);
}

async function listAdminProducts(db: D1Database): Promise<Array<AdminProductInput & { id: string }>> {
  const products = await db.prepare('SELECT * FROM products ORDER BY created_at DESC').all<Record<string, unknown>>();
  const variants = await db.prepare('SELECT * FROM product_variants ORDER BY color, size_type').all<Record<string, unknown>>();
  return products.results.map(product => ({
    id: String(product.id),
    title: String(product.title),
    sku: String(product.sku),
    category: String(product.category || ''),
    price: Number(product.price),
    discount: Number(product.discount || 0),
    description: String(product.description || ''),
    image: String(product.image || ''),
    variants: variants.results.filter(variant => String(variant.product_id) === String(product.id)).map(variant => ({
      color: String(variant.color),
      sizeType: String(variant.size_type || ''),
      stock: Number(variant.stock),
      imageUrl: String(variant.image_url || product.image || '')
    }))
  }));
}

async function saveAdminProduct(db: D1Database, input: AdminProductInput, existingId?: string): Promise<AdminProductInput & { id: string }> {
  const id = existingId || crypto.randomUUID();
  const productStatement = existingId
    ? db.prepare(`UPDATE products SET title = ?, sku = ?, category = ?, price = ?, discount = ?, description = ?, image = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(input.title, input.sku, input.category || '', input.price, input.discount || 0, input.description || '', input.image || '', id)
    : db.prepare(`INSERT INTO products (id, title, sku, category, price, discount, description, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, input.title, input.sku, input.category || '', input.price, input.discount || 0, input.description || '', input.image || '');
  const statements = [productStatement];
  if (existingId) statements.push(db.prepare('DELETE FROM product_variants WHERE product_id = ?').bind(id));
  for (const variant of input.variants || []) {
    statements.push(db.prepare('INSERT INTO product_variants (id, product_id, color, size_type, stock, image_url) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), id, variant.color, variant.sizeType || '', Math.max(0, Math.floor(Number(variant.stock) || 0)), variant.imageUrl || input.image || ''));
  }
  await db.batch(statements);
  const products = await listAdminProducts(db);
  return products.find(product => product.id === id) || { ...input, id, variants: input.variants || [] };
}

async function encryptSecret(value: string, passphrase: string): Promise<string> {
  const key = await deriveEncryptionKey(passphrase);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
  return `${encodeBase64(iv)}.${encodeBase64(new Uint8Array(ciphertext))}`;
}

async function decryptSecret(value: string, passphrase: string): Promise<string> {
  const [ivEncoded, ciphertextEncoded] = value.split('.');
  const key = await deriveEncryptionKey(passphrase);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64(ivEncoded) }, key, decodeBase64(ciphertextEncoded));
  return new TextDecoder().decode(plaintext);
}

async function deriveEncryptionKey(passphrase: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(passphrase));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function encodeBase64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function decodeBase64(value: string): Uint8Array { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }

async function getMidtransServerKey(env: Env): Promise<string> {
  if (env.MIDTRANS_SERVER_KEY) return env.MIDTRANS_SERVER_KEY;
  const setting = await env.DB.prepare('SELECT value FROM store_settings WHERE key = ?').bind('midtrans_server_key').first<{ value: string }>();
  return setting?.value ? decryptSecret(setting.value, env.ADMIN_ENCRYPTION_KEY) : '';
}

interface StoreKnowledge {
  name: string;
  address: string;
  location: string;
  customerService: string;
  openingTime: string;
  closingTime: string;
}

async function getStoreKnowledge(db: D1Database): Promise<StoreKnowledge> {
  const fallback: StoreKnowledge = {
    name: 'As-Syariah Bordir',
    address: 'Belum diatur di dashboard admin',
    location: 'Belum diatur di dashboard admin',
    customerService: 'Belum diatur di dashboard admin',
    openingTime: 'Belum diatur di dashboard admin',
    closingTime: 'Belum diatur di dashboard admin'
  };

  try {
    const rows = await db.prepare(
      `SELECT key, value FROM store_settings
      WHERE key IN ('store_name', 'store_address', 'store_location', 'customer_service', 'opening_time', 'closing_time')`
    ).all<{ key: string; value: string }>();
    const settings = Object.fromEntries(rows.results.map(row => [row.key, row.value]));
    return {
      name: settings.store_name || fallback.name,
      address: settings.store_address || fallback.address,
      location: settings.store_location || fallback.location,
      customerService: settings.customer_service || fallback.customerService,
      openingTime: settings.opening_time || fallback.openingTime,
      closingTime: settings.closing_time || fallback.closingTime
    };
  } catch (error) {
    console.error('Store knowledge error:', error);
    return fallback;
  }
}

function getJakartaTime(): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'full',
    timeStyle: 'long'
  }).format(new Date());
}

// Fungsi AI untuk chat interaktif & asisten pengelolaan keranjang belanja
async function getAIResponse(chatId: number, userMessage: string, env: Env): Promise<string> {
  try {
    const [products, store] = await Promise.all([fetchProducts(env), getStoreKnowledge(env.DB)]);
    if (!products) {
      return "Maaf, saya sedang tidak bisa mengakses katalog produk saat ini. Coba /produk nanti.";
    }

    const cart = await getCart(chatId, env);
    let cartContext = "Keranjang belanja pengguna saat ini masih kosong.";
    if (cart.items.length > 0) {
      cartContext = `Keranjang belanja pengguna saat ini berisi:\n` + 
        cart.items.map(i => {
          const emoji = getColorEmoji(i.variant);
          return `- ${i.title} (${emoji} Varian: ${i.variant}), Jumlah: ${i.quantity}, Harga Satuan: Rp${i.price.toLocaleString('id-ID')}`;
        }).join('\n') +
        `\nTotal belanja keranjang saat ini: Rp${cart.items.reduce((s, i) => s + (i.price * i.quantity), 0).toLocaleString('id-ID')}`;
    }

    const productList = products.map(p => 
      `- ${p.title} (SKU: ${p.sku}, Harga: Rp${p.discount || p.price}, Stok: ${p.stok}, Varian Warna: ${p.styles.map(s => s.name).join(', ')})`
    ).join('\n');

    const currentTime = getJakartaTime();
    const systemPrompt = `Kamu adalah asisten AI toko online ${store.name}.

  Informasi toko yang boleh kamu gunakan:
  - Nama toko: ${store.name}
  - Alamat toko: ${store.address}
  - Lokasi toko: ${store.location}
  - Nomor CS: ${store.customerService}
  - Jam operasional: ${store.openingTime} - ${store.closingTime} WIB
  - Waktu saat ini: ${currentTime} (WIB, Asia/Jakarta)

  Gunakan waktu saat ini hanya jika pengguna menanyakan tanggal atau jam. Gunakan jam operasional hanya jika sudah diatur di dashboard; jangan mengarang jadwal.

Data produk yang tersedia saat ini di toko kami (hanya yang terdaftar di bawah ini):
${productList}

Informasi Isi Keranjang Pengguna Saat Ini (Bisa berisi banyak jenis item dan variasi berbeda):
${cartContext}

Aturan & Kepribadian Chat AI:
1. Bersikaplah ramah, santai, komunikatif, dan profesional menggunakan Bahasa Indonesia yang natural.
2. Kamu menyadari sepenuhnya bahwa pengguna BISA memasukkan beberapa jenis produk dan variasi warna yang berbeda sekaligus ke keranjang belanja mereka.
3. JIKA pengguna bertanya atau bingung cara menambah produk, jelaskan bahwa mereka bisa memilih produk melalui menu /produk, lalu pilih tombol varian warna untuk memasukkannya ke keranjang.
4. JIKA pengguna ingin melihat isi keranjangnya, sarankan untuk mengetik atau mengklik perintah /keranjang.
5. JIKA pengguna menyatakan ingin segera menyelesaikan order, checkout, atau membayar seluruh isi keranjangnya, minta mereka dengan ramah untuk mengklik menu /checkout agar sistem otomatis memandu input alamat dan langsung memberikan link pembayaran aman dari Midtrans.
6. Jangan pernah membuat asumsi stok atau variasi warna di luar daftar produk di atas.`;

    const response = await env.AI.run('@cf/qwen/qwen3-30b-a3b-fp8', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]
    });
    return response.response || 'Maaf, saya tidak bisa menjawab sementara waktu. Silakan ketik /produk, /keranjang, atau /checkout.';
  } catch (e) {
    console.error('AI error:', e);
    return 'Terjadi sedikit gangguan koneksi pada asisten AI saya. Kamu bisa tetap melihat keranjang belanja lewat perintah /keranjang atau bayar via /checkout.';
  }
}

// Helper: Kirim tindakan chat (seperti 'typing') ke Telegram
async function sendTypingAction(token: string, chatId: number): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        action: 'typing'
      })
    });
  } catch (err) {
    console.error('Failed to send typing action:', err);
  }
}

// Helper: Kirim pesan teks ke Telegram
async function sendMessage(token: string, chatId: number, text: string, keyboard: any = null): Promise<void> {
  const body: any = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
  if (keyboard) body.reply_markup = keyboard;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      console.error('Telegram sendMessage error:', await res.text());
    }
  } catch (err) {
    console.error('Telegram fetch failed:', err);
  }
}
