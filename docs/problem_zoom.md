# Проблема: pinch-зум таймлайна в Android

## Контекст

Проект: `/home/dima/dev/local-bus`.

- Android: `android/app/src/main/java/app/localbus/MainActivity.kt`
- Карта: `android/app/src/main/java/app/localbus/TransitMap.kt`
- Ветка: `main`
- Последний запушенный коммит: `87b0cce Improve stop timeline interactions`

Задача: сделать плавный pinch-зум таймлайна внутри `ModalBottomSheet`.

Требования:

- масштабирование вокруг точки между пальцами;
- один палец скроллит таймлайн;
- при pinch не должен двигаться сам bottom sheet;
- bottom sheet обязан нормально раскрываться, сворачиваться и закрываться.

## Текущая реализация

`TimelineChart()` в `MainActivity.kt` использует ручной viewport.

- Внешний `Box` фиксирован: `384.dp`, с `clipToBounds()`.
- `Canvas` имеет размер viewport, его высота не меняется при зуме.
- `zoom` ограничен `1f..6f`.
- `scrollOffset` хранится в px.
- `timelineHeight = 1536.dp` сразу переводится в `timelineHeightPx`.
- Точки и линии рисуются вручную:

  ```kotlin
  y = timelineHeightPx * zoom * timeRatio - scrollOffset
  ```

- Обычный вертикальный скролл реализован через `rememberScrollableState`, изменяющий `scrollOffset`.
- Pinch реализован через `rememberTransformableState` с centroid:

  ```kotlin
  val focalContentY = (scrollOffset + centroid.y) / previousZoom
  zoom = nextZoom
  scrollOffset = focalContentY * nextZoom - centroid.y
  ```

- На внутреннем `Column` стоят:

  ```kotlin
  .transformable(state = transformState, canPan = { false }, lockRotationOnZoomPan = true)
  .scrollable(state = timelineScrollState, orientation = Orientation.Vertical)
  ```

Это пока лучшая версия: пользователь подтвердил, что зум стал заметно лучше. Затем добавили `clipToBounds`, потому что точки и линии рисовались вне viewport.

## Оставшиеся проблемы

1. Pinch иногда не распознаётся, особенно если второй палец поставлен не идеально одновременно.
2. При pinch иногда слегка двигается сам `ModalBottomSheet`.
3. Нельзя ломать стандартные жесты sheet: пользователь должен иметь возможность его сворачивать и закрывать.

## Предыдущие попытки

### A. `detectTransformGestures` + `ScrollState.dispatchRawDelta`

Первая реализация меняла `zoom` и вручную дёргала `dispatchRawDelta`, чтобы удерживать время под centroid.

Проблемы:

- `ScrollState` использует px, а высота canvas тогда была в dp — формула смешивала единицы;
- `dispatchRawDelta` обходит nested scroll, fling и приоритеты скролла;
- пользователь видел: сначала скролл вниз, затем прыжок к месту pinch.

Не возвращать эту реализацию. Android также предупреждает, что ручной вызов `dispatchRawDelta` приводит к плохому UX.

### B. `transformable` без centroid

Была попытка оставить только `transformable` и менять `zoom` без сохранения фокусной точки.

Результат: zoom визуально привязывался к верху таймлайна, а не к пальцам. Пользователь сказал, что зум фактически не работает как нужно. Откатили.

### C. `detectTransformGestures` + `scrollTo` после `withFrameNanos`

Исправили dp/px и заменили raw delta на `scrollTo` после следующего кадра.

Результат: layout сначала менял высоту, затем асинхронно догонял `scrollTo`; возникала гонка между layout и scroll, зум оставался дёрганым. Откатили в пользу текущего ручного viewport.

### D. `sheetGesturesEnabled` по наличию касания в таймлайне

Через `pointerInteropFilter` отключали жесты `ModalBottomSheet`, пока палец находится в таймлайне.

Результат: состояние могло не сброситься после касания, из-за чего sheet переставал вообще сворачиваться и закрываться. Откатили.

### E. `sheetGesturesEnabled` только при `transformState.isTransformInProgress`

Идея была лучше: отключать sheet только после распознавания pinch. Но смена параметра `ModalBottomSheet` во время активного pointer gesture может пересобрать/отменить gesture pipeline и сломать сам pinch. Эксперимент полностью откатили.

В текущем исходнике нет ни `pointerInteropFilter`, ни `sheetGesturesEnabled` для этой задачи.

### F. Low-level `awaitPointerEvent` / `awaitFirstDown`

Пробовали отслеживать касания через низкоуровневые Compose API, но в фактической версии Compose проекта эти импорты недоступны. Kotlin compilation failed, код удалён.

## Смежные исправления

- Открытие stop sheet ускорено: `TransitMap` больше не пересобирает все слои при изменении только `selectedStop`. `MapRenderState.shouldRender()` сравнивает style, snapshot, routes, direction и тему.
- В `StopSheet` тяжёлое вычисление `routeInfo` отложено и вынесено в `Dispatchers.Default`, чтобы сначала показать sheet, заголовок и loader.
- Эти изменения уже вошли в `87b0cce`.

## Рекомендованное направление

Нужно изолировать два пальца от draggable `ModalBottomSheet`, не меняя `sheetGesturesEnabled` во время активного pointer gesture и не отменяя `transformable`.

Вероятный путь:

1. Оставить текущую ручную viewport-архитектуру — она решила основную проблему рывков.
2. Добавить совместимый с текущей версией Compose `NestedScrollConnection` на область таймлайна. Пока есть два активных pointer’а, он должен съедать вертикальные pre/post scroll delta и velocity, не отдавая их родительскому sheet.
3. Pointer count отслеживать пассивно и надёжно сбрасывать на `UP`/`CANCEL`, но не использовать это состояние для изменения конфигурации `ModalBottomSheet`.
4. Проверить конфликт дочернего `Canvas` с `detectTapGestures` и родительского `transformable`: возможно, tap detector нужно перенести или организовать так, чтобы multi-touch не перехватывался Canvas.

## Ограничения проверки

- Не запускать и не force-stop’ить приложение.
- Собирать и ставить Android-версию только через `./android/debug.sh`, не отдельной Gradle-командой.
- Нужна реальная проверка на телефоне: сборка сама по себе не доказывает корректность физических жестов.
