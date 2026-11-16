# Chess Analyzer

![License](https://img.shields.io/badge/License-GPLv3-green)
![Platform](https://img.shields.io/badge/Platform-Android-red)
![Language](https://img.shields.io/badge/Language-TypeScript-blue)

Разбор шахматных партий со Stockfish. Вставляешь PGN, а в ответ получаешь оценку каждого хода: где зевнул, где упустил мат, а где сыграл по-настоящему красиво.

Работает в браузере и на Android. Считать можно на своём сервере или прямо на телефоне, без интернета.

## Что умеет

- Оценивает каждый ход: блестящий, лучший, неточность, ошибка, упущенная возможность, грубая ошибка
- Показывает точность игры каждой стороны
- Рисует полосу оценки, график партии и стрелку лучшего хода
- Сохраняет готовый анализ в файл. Можно разобрать партию на мощном компьютере, а потом открыть результат на телефоне
- Две схемы работы: нативный Stockfish на сервере или WASM на устройстве

## Запуск

Нужен Node.js 22+ и [Stockfish](https://stockfishchess.org/download/).

**Бэкенд**

```bash
cd backend
npm i
```

Бинарник [Stockfish](https://stockfishchess.org/download/) поместить в `backend/engines/` и вписать путь к самому файлу в переменную окружения (или .env):

```
PORT=3000
STOCKFISH_PATH=engines/stockfish
```

Дальше `npm run dev`. Сервер поднимется на `localhost:3000`.

**Фронтенд**

```bash
cd frontend
npm i
npm run dev
```

## Android

Нужны JDK 21, Android SDK и `adb`.

### Debag

Необходим frontend/.env с переменными 
- **`ANDROID_HOME`**
- **`ANDROID_SDK_ROOT`**

Сборка

```bash
cd frontend
npm run android-dev
```

### Release

Необходим frontend/.env с переменными 
- `ANDROID_HOME`
- `ANDROID_SDK_ROOT`
- **`RELEASE_KEYSTORE`**
- **`RELEASE_STORE_PASSWORD`**
- **`RELEASE_KEY_ALIAS`**
- **`RELEASE_KEY_PASSWORD`**

Так же для подписи необходимо добавить в `android/app/build.gradle`:

```gradle
android {
    signingConfigs {
        release {
            storeFile file(System.getenv("RELEASE_KEYSTORE"))
            storePassword System.getenv("RELEASE_STORE_PASSWORD")
            keyAlias System.getenv("RELEASE_KEY_ALIAS")
            keyPassword System.getenv("RELEASE_KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
        }
    }
}
```

Сборка

```bash
cd frontend
npm run android
```

## Лицензия

GNU GPLv3, см. [LICENSE](LICENSE). 