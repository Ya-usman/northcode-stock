# Generate PWA Icons — StockShop

Use `icon.svg` (already updated) to regenerate all icon sizes.

## Generate commands (using sharp CLI):
```bash
npm install -g sharp-cli

for size in 72 96 128 144 152 192 384 512; do
  sharp -i icon.svg -o icon-${size}x${size}.png resize ${size} ${size}
done
```

## Or use an online tool:
Upload `icon.svg` to https://realfavicongenerator.net and download all sizes.
