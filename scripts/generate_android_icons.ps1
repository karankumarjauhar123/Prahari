# scripts/generate_android_icons.ps1
# PowerShell script to resize and mask app icons for Android using native .NET libraries.
# Works out-of-the-box on Windows without Python/Node dependencies.

Add-Type -AssemblyName System.Drawing

$sourceImgPath = "C:\Users\KARAN KUMAR JAUHAR\.gemini\antigravity\brain\346ce96d-8f24-4b40-9ac3-1b3db7561991\prahari_app_icon_1780448904598.png"
$resDir = "d:\PRAHARI_complete-1\PRAHARI\android\app\src\main\res"

# Android Launcher Icon sizes
$sizes = @{
    "mipmap-mdpi" = 48
    "mipmap-hdpi" = 72
    "mipmap-xhdpi" = 96
    "mipmap-xxhdpi" = 144
    "mipmap-xxxhdpi" = 192
}

if (-not (Test-Path $sourceImgPath)) {
    Write-Error "Source image not found at: $sourceImgPath"
    exit 1
}

# Load the source image
$srcImg = [System.Drawing.Image]::FromFile($sourceImgPath)

foreach ($folder in $sizes.Keys) {
    $size = $sizes[$folder]
    $folderPath = Join-Path $resDir $folder
    if (-not (Test-Path $folderPath)) {
        New-Item -ItemType Directory -Path $folderPath -Force | Out-Null
    }

    # ------------------ 1. Generate Square Icon (ic_launcher.png) ------------------
    $squareBmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($squareBmp)
    
    # High-quality interpolation/resizing settings
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    
    # Draw original image scaled to target size
    $g.DrawImage($srcImg, 0, 0, $size, $size)
    $g.Dispose()

    $squarePath = Join-Path $folderPath "ic_launcher.png"
    $squareBmp.Save($squarePath, [System.Drawing.Imaging.ImageFormat]::Png)
    $squareBmp.Dispose()
    Write-Host "Saved: $squarePath ($size x $size)"

    # ------------------ 2. Generate Round Icon (ic_launcher_round.png) ------------------
    # We load the newly created square icon, resize it, and apply a circular mask
    $squareBmpForRound = New-Object System.Drawing.Bitmap $size, $size
    $gSquare = [System.Drawing.Graphics]::FromImage($squareBmpForRound)
    $gSquare.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gSquare.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $gSquare.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $gSquare.DrawImage($srcImg, 0, 0, $size, $size)
    $gSquare.Dispose()

    $roundBmp = New-Object System.Drawing.Bitmap $size, $size
    $gRound = [System.Drawing.Graphics]::FromImage($roundBmp)
    $gRound.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $gRound.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gRound.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    
    # Create circular clip path
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse(0, 0, $size, $size)
    $gRound.SetClip($path)
    
    # Draw the square image within the circular clip
    $gRound.DrawImage($squareBmpForRound, 0, 0, $size, $size)
    
    $path.Dispose()
    $gRound.Dispose()
    $squareBmpForRound.Dispose()

    $roundPath = Join-Path $folderPath "ic_launcher_round.png"
    $roundBmp.Save($roundPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $roundBmp.Dispose()
    Write-Host "Saved: $roundPath ($size x $size)"
}

$srcImg.Dispose()
Write-Host "Success: All Android launcher icons generated successfully!"
