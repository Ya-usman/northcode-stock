const sharp = require('sharp')
const path = require('path')
const fs = require('fs')

const sizes = [72, 96, 128, 144, 152, 192, 384, 512]
const iconsDir = path.join(__dirname, '../public/icons')

// Simple blue square SVG with "NC" text
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="80" fill="#0A2F6E"/>
  <text x="256" y="320" font-family="Arial, sans-serif" font-size="220" font-weight="bold"
    fill="white" text-anchor="middle">NC</text>
</svg>`

const svgBuffer = Buffer.from(svg)

async function generate() {
  for (const size of sizes) {
    const file = path.join(iconsDir, `icon-${size}x${size}.png`)
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(file)
    console.log(`✓ icon-${size}x${size}.png`)
  }
  console.log('All icons generated!')
}

generate().catch(console.error)
