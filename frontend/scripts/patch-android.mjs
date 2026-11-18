// Настраивает Android-проект после `cap add android`:
//  1) приём PGN из «Поделиться»: копирует нативный код и добавляет фильтры в манифест;
//  2) подпись релизной сборки: добавляет signingConfigs в app/build.gradle (данные берутся из переменных окружения).
// Безопасно запускать повторно. Вызывается из build-android.sh после `cap add android`.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const manifestPath = 'android/app/src/main/AndroidManifest.xml';
const gradlePath = 'android/app/build.gradle';

if (!existsSync(manifestPath) || !existsSync(gradlePath)) {
    console.error('Папки android/ нет. Сначала выполните: npx cap add android');
    process.exit(1);
}

// Пакет берём из самого проекта (namespace), а не из константы: он равен appId из capacitor.config.ts
const namespace = readFileSync(gradlePath, 'utf8').match(/namespace\s*=?\s*["']([\w.]+)["']/)?.[1];
if (!namespace) {
    console.error('Не удалось определить namespace в android/app/build.gradle');
    process.exit(1);
}

const javaDir = `android/app/src/main/java/${namespace.replaceAll('.', '/')}`;
mkdirSync(javaDir, { recursive: true });
for (const file of ['MainActivity.java', 'ShareTargetPlugin.java']) {
    const source = readFileSync(`native/android/${file}`, 'utf8').replace(/^package\s+[\w.]+;/m, `package ${namespace};`);
    writeFileSync(`${javaDir}/${file}`, source);
}
console.log(`Нативный код скопирован в ${javaDir} (пакет ${namespace})`);

let xml = readFileSync(manifestPath, 'utf8');
if (!xml.includes('android.intent.action.SEND')) {
    const filter = (mime) => `
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="${mime}" />
            </intent-filter>`;
    xml = xml.replace('</activity>', `${filter('text/plain')}${filter('application/x-chess-pgn')}\n        </activity>`);
    writeFileSync(manifestPath, xml);
    console.log('AndroidManifest.xml: добавлены фильтры приёма PGN');
}

// ---------- подпись релиза ----------
let gradle = readFileSync(gradlePath, 'utf8');
if (gradle.includes('signingConfigs')) {
    console.log('build.gradle: подпись релиза уже настроена');
} else {
    // Проверка на пустую переменную нужна: без неё `file(null)` падает при настройке проекта
    // и ломает даже debug-сборку, когда RELEASE_KEYSTORE не задан.
    const signing = `    signingConfigs {
        release {
            def keystore = System.getenv("RELEASE_KEYSTORE")
            if (keystore) {
                storeFile file(keystore)
                storePassword System.getenv("RELEASE_STORE_PASSWORD")
                keyAlias System.getenv("RELEASE_KEY_ALIAS")
                keyPassword System.getenv("RELEASE_KEY_PASSWORD")
            }
        }
    }
`;
    const withSigning = gradle.replace(/^([ \t]*)buildTypes\s*\{/m, (match) => signing + match);
    const withRelease = withSigning.replace(
        /(buildTypes\s*\{\s*release\s*\{)/,
        '$1\n            signingConfig signingConfigs.release',
    );

    if (withSigning === gradle || withRelease === withSigning) {
        console.error('build.gradle: не нашёл блок buildTypes { release { ... } }, подпись не добавлена');
        process.exit(1);
    }
    writeFileSync(gradlePath, withRelease);
    console.log('build.gradle: добавлена подпись релиза (RELEASE_KEYSTORE и др.)');
}
