# Transport Map for Android

The Android app is deliberately a separate Gradle project so the existing Vue/Bun
application remains runnable without Android tooling.

Build from this repository with the wrapper already used by `../step`:

```sh
bash ../step/gradlew -p android :app:assembleDebug
```

To build and install a debug APK on the single connected Android device:

```sh
./android/debug.sh
```

The Android client always uses the production backend:
`https://transit.hrebeni.uk`.
