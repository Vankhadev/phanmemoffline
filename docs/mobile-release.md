# Phat hanh mobile Android va iOS

Ung dung mobile dung Capacitor de dong goi frontend React hien co thanh app native.

## Yeu cau quan trong

- Dien thoai khong goi duoc backend `127.0.0.1` tren may tinh. Truoc khi build mobile, can co backend HTTPS public hoac backend LAN test ma dien thoai truy cap duoc.
- Build production nen dung HTTPS va URL phai ket thuc bang `/api`, vi frontend goi cac route API hien co.
- Android/CH Play dung project `android/`.
- iPhone/App Store dung project `ios/`, can may macOS co Xcode va Apple Developer account.

## Cau hinh API

PowerShell:

```powershell
$env:VITE_API_BASE_URL="https://api.example.com/api"
```

CMD:

```cmd
set VITE_API_BASE_URL=https://api.example.com/api
```

Co the xem mau tai `frontend/.env.example`.

## Dong bo web vao native

```cmd
npm run mobile:sync
```

Lenh nay build frontend mobile bang `scripts/build-mobile.js`, sau do chay `cap sync` de copy web assets vao Android/iOS.

## Android APK va CH Play

Mo Android Studio:

```cmd
npm run mobile:android
```

Xuat APK debug de cai thu truc tiep:

```cmd
npm run mobile:android:apk
```

APK debug nam tai:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

De dua len CH Play, nen tao signed Android App Bundle (AAB) trong Android Studio:

```text
Build > Generate Signed Bundle / APK > Android App Bundle
```

Script tham khao:

```cmd
npm run mobile:android:aab
```

Lenh AAB can cau hinh keystore/signing truoc khi phat hanh chinh thuc.

## iPhone va App Store

Tren macOS co Xcode:

```cmd
npm ci
set VITE_API_BASE_URL=https://api.example.com/api
npm run mobile:ios
```

Sau do trong Xcode:

```text
Product > Archive > Distribute App > App Store Connect
```

## Luu y hien tai

- May Windows dang thao tac khong co `JAVA_HOME`/`java` trong PATH, nen chua xuat duoc APK truc tiep tu Gradle.
- `npx cap doctor` bao iOS thieu Xcode; day la binh thuong tren Windows.
- Chunk frontend lon hon 1500 kB la canh bao co san cua Vite, khong chan build mobile.
