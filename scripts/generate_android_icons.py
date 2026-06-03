#!/usr/bin/env python3
import os
import sys
from PIL import Image, ImageOps, ImageDraw

# Paths
ROOT_DIR = "d:/PRAHARI_complete-1/PRAHARI"
RES_DIR = os.path.join(ROOT_DIR, "android/app/src/main/res")
SOURCE_IMG = "C:/Users/KARAN KUMAR JAUHAR/.gemini/antigravity/brain/346ce96d-8f24-4b40-9ac3-1b3db7561991/prahari_app_icon_1780448904598.png"

# Icon dimensions for Android launcher
SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192
}

def make_circular(img):
    """Applies a high-quality circular mask to the image."""
    size = img.size
    mask = Image.new('L', size, 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0) + size, fill=255)
    
    output = Image.new('RGBA', size, (0, 0, 0, 0))
    output.paste(img, (0, 0), mask=mask)
    return output

def process_icons():
    if not os.path.exists(SOURCE_IMG):
        print(f"Error: Source image not found at {SOURCE_IMG}")
        sys.exit(1)
        
    try:
        base_img = Image.open(SOURCE_IMG).convert("RGBA")
    except Exception as e:
        print(f"Error opening source image: {e}")
        sys.exit(1)
        
    print(f"Processing icons from source: {SOURCE_IMG}")
    
    for folder, size in SIZES.items():
        folder_path = os.path.join(RES_DIR, folder)
        os.makedirs(folder_path, exist_ok=True)
        
        # Resize using high-quality Lanczos resampling
        resized_square = base_img.resize((size, size), Image.Resampling.LANCZOS)
        
        # Save square icon (ic_launcher.png)
        square_path = os.path.join(folder_path, "ic_launcher.png")
        resized_square.save(square_path, "PNG", optimize=True)
        print(f"Saved {square_path} ({size}x{size})")
        
        # Save round icon (ic_launcher_round.png)
        resized_round = make_circular(resized_square)
        round_path = os.path.join(folder_path, "ic_launcher_round.png")
        resized_round.save(round_path, "PNG", optimize=True)
        print(f"Saved {round_path} ({size}x{size})")
        
    print("Successfully generated and optimized all Android Launcher Icons!")

if __name__ == "__main__":
    process_icons()
