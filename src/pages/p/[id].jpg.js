// Imagen JPG de cada publicación para la vista previa de WhatsApp/Facebook (/p/<id>.jpg)
import sharp from 'sharp';
import { getApprovedListings } from '../../lib/market.js';

export async function getStaticPaths() {
  return (await getApprovedListings()).map((l) => ({ params: { id: String(l.id) }, props: { listing: l } }));
}

export async function GET({ props }) {
  const src = props.listing.images?.[0];
  let input;
  if (src) {
    const res = await fetch(src);
    if (res.ok) input = Buffer.from(await res.arrayBuffer());
  }
  // 1200x630 (formato recomendado), sin recortar el producto
  const img = input
    ? sharp(input).resize(1200, 630, { fit: 'contain', background: '#ffffff' })
    : sharp({ create: { width: 1200, height: 630, channels: 3, background: '#16a34a' } });
  const jpg = await img.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  return new Response(jpg, { headers: { 'Content-Type': 'image/jpeg' } });
}
