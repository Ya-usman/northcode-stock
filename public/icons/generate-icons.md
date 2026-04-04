# Generate PWA Icons

Use the NC logo SVG below to generate all icon sizes.
Run this command after installing `sharp` or use an online tool like https://realfavicongenerator.net

## Base SVG (save as icon-base.svg):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- Background -->
  <rect width="512" height="512" rx="80" fill="#0A2F6E"/>
  <!-- NC text -->
  <text
    x="50%"
    y="54%"
    dominant-baseline="middle"
    text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-weight="bold"
    font-size="240"
    fill="#FFFFFF"
    letter-spacing="-8"
  >NC</text>
  <!-- Bottom accent line -->
  <rect x="156" y="370" width="200" height="12" rx="6" fill="#D4AF37"/>
</svg>
```

## Generate commands (using sharp CLI):
```bash
npm install -g sharp-cli

for size in 72 96 128 144 152 192 384 512; do
  sharp -i icon-base.svg -o icon-${size}x${size}.png resize ${size} ${size}
done
```

## Or use Vercel's @vercel/og to generate icons programmatically.

## Quick placeholder (creates colored PNG):
You can use https://placehold.co to quickly test:
- https://placehold.co/192x192/0A2F6E/FFFFFF?text=NC&font=montserrat
- https://placehold.co/512x512/0A2F6E/FFFFFF?text=NC&font=montserrat
