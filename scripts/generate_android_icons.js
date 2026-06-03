// scripts/generate_android_icons.js
// Node.js script to resize and mask app icons for Android using 'jimp'.
// Pure JavaScript image library with zero native compiling dependencies.

const fs = require('fs');
const path = require('path');

async function run() {
  let Jimp;
  try {
    const jimpModule = require('jimp');
    Jimp = jimpModule.Jimp || jimpModule;
  } catch (err) {
    console.error('Error: "jimp" is not installed. Please run "npm install jimp" first.');
    process.exit(1);
  }

  const sourceImgPath = "C:\\Users\\KARAN KUMAR JAUHAR\\.gemini\\antigravity\\brain\\346ce96d-8f24-4b40-9ac3-1b3db7561991\\prahari_high_visibility_icon_1780452215001.png";
  const resDir = "d:\\PRAHARI_complete-1\\PRAHARI\\android\\app\\src\\main\\res";

  // Android Launcher Icon sizes
  const sizes = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192
  };

  if (!fs.existsSync(sourceImgPath)) {
    console.error(`Error: Source image not found at: ${sourceImgPath}`);
    process.exit(1);
  }

  console.log(`Loading source image: ${sourceImgPath}`);

  for (const [folder, size] of Object.entries(sizes)) {
    const folderPath = path.join(resDir, folder);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    try {
      // 1. Generate Square Icon (ic_launcher.png)
      const image = await Jimp.read(sourceImgPath);
      
      // Resize with high quality
      image.resize({ w: size, h: size });
      
      // Save square icon
      const squarePath = path.join(folderPath, "ic_launcher.png");
      await image.write(squarePath);
      console.log(`Saved: ${squarePath} (${size}x${size})`);

      // 2. Generate Round Icon (ic_launcher_round.png)
      // Custom pixel loop to mask to circle (extremely robust, pure JS)
      const radius = size / 2;
      const center = radius;
      
      image.scan(0, 0, size, size, function (x, y, idx) {
        // Calculate distance from center of the pixel to the center of the image
        const distance = Math.sqrt(Math.pow(x - center, 2) + Math.pow(y - center, 2));
        if (distance > radius) {
          this.bitmap.data[idx + 3] = 0; // Set alpha channel to 0 (fully transparent)
        }
      });

      const roundPath = path.join(folderPath, "ic_launcher_round.png");
      await image.write(roundPath);
      console.log(`Saved: ${roundPath} (${size}x${size})`);

    } catch (iconError) {
      console.error(`Error generating icons for size ${size}:`, iconError);
    }
  }

  console.log("Success: All Android launcher icons generated successfully using Jimp!");
}

run();
