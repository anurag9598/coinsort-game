# 🚀 COIN SORT PUZZLE — Complete Play Store Publishing Guide
# ═══════════════════════════════════════════════════════════

## PROJECT STRUCTURE
```
CoinSortGame/
├── App.js                          ← Main entry point
├── app.json                        ← Expo configuration
├── eas.json                        ← EAS build profiles
├── package.json                    ← Dependencies
├── babel.config.js
├── assets/
│   ├── icon.png                    ← 1024×1024 (convert from store-assets/icon.svg)
│   ├── adaptive-icon.png           ← 1024×1024 (same)
│   └── splash.png                  ← 1284×2778 recommended
├── src/
│   ├── game/
│   │   ├── constants.js            ← Game config
│   │   └── logic.js                ← Pure game logic
│   ├── audio/
│   │   └── AudioEngine.js          ← Synthesized music + SFX
│   └── components/
│       ├── CoinFace.js             ← SVG coin component
│       └── RackSlot.js             ← Rack slot component
└── store-assets/
    ├── icon.svg                    ← 512×512 app icon
    ├── feature-graphic.svg         ← 1024×500 Play Store banner
    └── store-listing.md            ← All store copy
```

---

## STEP 1 — LOCAL SETUP (15 min)

```bash
# 1. Install Node.js 18+ from https://nodejs.org

# 2. Install Expo CLI
npm install -g expo-cli eas-cli

# 3. Create Expo account at https://expo.dev/signup

# 4. Navigate to project
cd CoinSortGame

# 5. Install dependencies
npm install

# 6. Convert SVG icons to PNG (install Inkscape or use https://cloudconvert.com)
# icon.svg → assets/icon.png          (1024×1024)
# icon.svg → assets/adaptive-icon.png (1024×1024)
# Create a dark splash: #0c1825 background, centered coin SVG

# 7. Test on device/emulator
npx expo start
# Press 'a' for Android emulator or scan QR with Expo Go app
```

---

## STEP 2 — CONFIGURE EAS (5 min)

```bash
# Login to your Expo account
eas login

# Link project (creates projectId in app.json)
eas build:configure

# Update app.json with the generated projectId
```

---

## STEP 3 — BUILD THE AAB (15–20 min, cloud build)

```bash
# Production build (creates .aab for Play Store)
eas build --platform android --profile production

# When prompted: generate new keystore = YES (first time)
# EAS stores it securely. SAVE the keystore credentials email!

# Download link will be emailed + shown in terminal
# Also visible at: https://expo.dev/accounts/YOUR_NAME/builds
```

---

## STEP 4 — GOOGLE PLAY DEVELOPER ACCOUNT (1–2 days)

1. Go to https://play.google.com/console
2. Click "Get started"
3. Pay $25 one-time fee (credit card)
4. Fill out developer profile
5. Complete identity verification (government ID)
6. Wait for approval email (usually same day, sometimes 2 days)

---

## STEP 5 — CREATE APP IN PLAY CONSOLE (30 min)

1. Log into Play Console → "Create app"
2. Fill in:
   - App name: "Coin Sort Puzzle - Stack & Match"
   - Default language: English
   - App or Game: **Game**
   - Free or Paid: **Free**
3. Click "Create app"

### Complete Required Sections:

**Store listing:**
- Title, short + full description → copy from store-assets/store-listing.md
- Upload icon.svg converted to 512×512 PNG
- Upload feature-graphic.svg converted to 1024×500 PNG
- Upload 2+ screenshots (1080×1920 PNG)

**App content:**
- Content rating → fill questionnaire → "Casual" game, no issues → Rated E
- Target audience → 13+ recommended
- Privacy policy → paste your policy URL (host on GitHub Pages)

**Privacy Policy Setup (free):**
```
1. Create GitHub account
2. New repo: "coin-sort-policy"
3. Add index.html with privacy policy text (from store-listing.md)
4. Enable GitHub Pages in Settings
5. URL: https://YOUR_USERNAME.github.io/coin-sort-policy
```

**Pricing:**
- Countries → Select all → Free

---

## STEP 6 — CREATE PRODUCTION RELEASE

1. Play Console → Production → Releases → "Create new release"
2. Click "Upload" → select your .aab file
3. Release name: "1.0.0"
4. Release notes: copy from store-listing.md "What's New"
5. Click "Save" → "Review release"
6. Fix any warnings (usually just content rating / policy)
7. Click "Start rollout to Production"

---

## STEP 7 — WAIT FOR REVIEW ☕

- **First-time apps:** 7–14 days review
- **Updates:** Usually 24–48 hours
- You'll get an email when approved or if action needed
- Common rejections: missing privacy policy, content rating issues

---

## CHECKLIST ✅

Before submitting, verify:
- [ ] `package` name in app.json is unique (com.yourname.coinsorting)
- [ ] `versionCode` is 1 for first release
- [ ] Privacy policy URL is live and accessible
- [ ] Content rating questionnaire filled
- [ ] At least 2 screenshots uploaded (4–8 recommended)
- [ ] Feature graphic uploaded (1024×500)
- [ ] App icon uploaded (512×512 PNG, no rounded corners — Play Store adds them)
- [ ] Short description ≤ 80 chars
- [ ] Full description ≤ 4000 chars
- [ ] Release notes added

---

## UPDATING THE APP LATER

```bash
# 1. Bump version in app.json:
#    "version": "1.0.1"
#    "versionCode": 2   ← must always increase

# 2. Build new AAB
eas build --platform android --profile production

# 3. In Play Console → Production → Create new release → Upload new .aab
```

---

## ESTIMATED TIMELINE

| Day | Task |
|-----|------|
| 1   | Setup Expo, test on emulator, build AAB |
| 1   | Sign up for Play Console ($25) |
| 1–2 | Account verification |
| 2   | Create app, upload assets, fill store listing |
| 2   | Submit for review |
| 7–14| App goes LIVE 🎉 |

---

## SUPPORT & RESOURCES

- Expo docs:        https://docs.expo.dev
- EAS build docs:   https://docs.expo.dev/build/introduction/
- Play Console help:https://support.google.com/googleplay/android-developer
- Icon converter:   https://cloudconvert.com/svg-to-png
- Privacy policy:   https://privacypolicygenerator.info

Good luck! 🚀 Your game is ready to ship.
