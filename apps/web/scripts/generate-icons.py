#!/usr/bin/env python3
"""Генератор PNG-иконок PWA для знака концепта «Цифровой деканат».

Знак концепта — СВОЙ идентификатор прототипа (требование кейса: логотип
вуза не используется). Источник истины по геометрии — `public/icon.svg`:
скрипт читает его и растеризует ограниченное подмножество SVG
(rect / line / polyline / circle, цвета #rgb и #rrggbb), которого
достаточно для знака. Никаких внешних зависимостей и сетевых шрифтов:
только Pillow (PIL) из стандартного набора инструментов.

Выходные файлы (в public/, рядом с манифестом):
  icon-192.png             — 192×192, «любая» цель (PWA, Android)
  icon-512.png             — 512×512, «любая» цель (PWA, Android)
  icon-maskable-512.png    — 512×512, full-bleed фон + знак в safe-zone
                             (круг 80% диаметра — маскация Android)
  apple-touch-icon-180.png — 180×180, full-bleed фон (iOS сам скругляет
                             углы; прозрачности быть не должно)

Перегенерировать после правки icon.svg:

    python3 apps/web/scripts/generate-icons.py

или с явными путями:

    python3 apps/web/scripts/generate-icons.py \
        --svg apps/web/public/icon.svg --out apps/web/public
"""
from __future__ import annotations

import argparse
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image, ImageDraw

# Множитель суперсэмплинга: рисуем в 4 раза больше и уменьшаем
# LANCZOS — иначе пиксельные артефакты на скруглениях и штрихах.
SUPERSAMPLE = 4

# Доля safe-zone для maskable: Android показывает только центральный
# круг диаметром 80% иконки, поэтому знак масштабируем до 0.78.
MASKABLE_SCALE = 0.78
# iOS применяет свою скруглённую маску: знак крупнее, чем у maskable,
# но не во весь кадр (0.86 от safe-zone 512).
APPLE_SCALE = 0.86

# Цвет по умолчанию — непрозрачный чёрный (если в SVG не указан fill).
BLACK = (0, 0, 0, 255)


# ---------------------------------------------------------------------------
# Разбор SVG (ограниченное подмножество — ровно то, что есть в icon.svg)
# ---------------------------------------------------------------------------


def parse_color(value: str | None) -> tuple[int, int, int, int] | None:
    """#rgb / #rrggbb / #rrggbbaa / 'none' → RGBA-кортеж (None — без заливки)."""
    if value is None:
        return None
    text = value.strip()
    if text == "" or text.lower() == "none":
        return None
    if not text.startswith("#"):
        raise ValueError(f"неподдерживаемый формат цвета: {value!r}")
    digits = text[1:]
    if len(digits) == 3:
        digits = "".join(ch * 2 for ch in digits)
    if len(digits) == 6:
        digits += "ff"
    if len(digits) != 8:
        raise ValueError(f"неподдерживаемый формат цвета: {value!r}")
    return (
        int(digits[0:2], 16),
        int(digits[2:4], 16),
        int(digits[4:6], 16),
        int(digits[6:8], 16),
    )


def number(value: str | None, default: float = 0.0) -> float:
    if value is None or value.strip() == "":
        return default
    return float(value.strip())


def points_of(value: str) -> list[tuple[float, float]]:
    """'x,y x,y …' → список точек."""
    result: list[tuple[float, float]] = []
    for chunk in value.replace(",", " ").split():
        result.append(float(chunk))
    return [
        (result[index], result[index + 1]) for index in range(0, len(result) - 1, 2)
    ]


class Shape:
    """Единица рисования: вид + геометрия + стиль."""

    def __init__(self, kind: str, geometry: dict, style: dict) -> None:
        self.kind = kind
        self.geometry = geometry
        self.style = style


def load_shapes(svg_path: Path) -> tuple[float, float, list[Shape]]:
    """Читает SVG: возвращает (ширина, высота viewBox, список фигур)."""
    root = ET.parse(svg_path).getroot()
    view_box = root.get("viewBox")
    if view_box is None:
        raise ValueError("в icon.svg обязателен viewBox")
    parts = [float(chunk) for chunk in view_box.replace(",", " ").split()]
    if len(parts) != 4:
        raise ValueError(f"не разобрать viewBox: {view_box!r}")
    _, _, width, height = parts

    shapes: list[Shape] = []
    for element in root:
        style = {
            "fill": parse_color(element.get("fill")),
            "stroke": parse_color(element.get("stroke")),
            "stroke_width": number(element.get("stroke-width")),
        }
        tag = element.tag.split("}")[-1]
        if tag == "rect":
            shapes.append(
                Shape(
                    "rect",
                    {
                        "x": number(element.get("x")),
                        "y": number(element.get("y")),
                        "w": number(element.get("width")),
                        "h": number(element.get("height")),
                        "rx": number(element.get("rx")),
                    },
                    style,
                )
            )
        elif tag == "line":
            shapes.append(
                Shape(
                    "polyline",
                    {
                        "points": [
                            (number(element.get("x1")), number(element.get("y1"))),
                            (number(element.get("x2")), number(element.get("y2"))),
                        ]
                    },
                    style,
                )
            )
        elif tag in ("polyline", "polygon"):
            shapes.append(Shape("polyline", {"points": points_of(element.get("points", ""))}, style))
        elif tag == "circle":
            shapes.append(
                Shape(
                    "circle",
                    {
                        "cx": number(element.get("cx")),
                        "cy": number(element.get("cy")),
                        "r": number(element.get("r")),
                    },
                    style,
                )
            )
        elif tag == "title":
            continue
        else:
            raise ValueError(f"неподдерживаемый элемент SVG: <{tag}>")

    return width, height, shapes


# ---------------------------------------------------------------------------
# Растеризация
# ---------------------------------------------------------------------------


def draw_shapes(draw: ImageDraw.ImageDraw, shapes: list[Shape], scale: float, offset: tuple[float, float]) -> None:
    """Рисует фигуры в системе координат выходного canvasa.

    scale/offset пересчитывают координаты viewBox → пиксели (и обратно —
    используются для масштабирования знака внутри safe-zone).
    """
    ox, oy = offset

    def mapped(point: tuple[float, float]) -> tuple[float, float]:
        return (point[0] * scale + ox, point[1] * scale + oy)

    for shape in shapes:
        fill = shape.style["fill"]
        stroke = shape.style["stroke"]
        stroke_width = shape.style["stroke_width"] * scale
        geometry = shape.geometry

        if shape.kind == "rect":
            x, y = mapped((geometry["x"], geometry["y"]))
            w, h = geometry["w"] * scale, geometry["h"] * scale
            radius = geometry["rx"] * scale
            box = [x, y, x + w, y + h]
            if radius > 0:
                draw.rounded_rectangle(box, radius=radius, fill=fill, outline=stroke, width=max(1, round(stroke_width)))
            else:
                draw.rectangle(box, fill=fill, outline=stroke, width=max(1, round(stroke_width)))
            continue

        if shape.kind == "circle":
            cx, cy = mapped((geometry["cx"], geometry["cy"]))
            radius = geometry["r"] * scale
            draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=fill, outline=stroke, width=max(1, round(stroke_width)))
            continue

        # polyline: штрих рисуем толстыми отрезками с округлыми торцами
        # (Pillow не умеет linecap — закрываем кругом в каждой вершине).
        points = [mapped(point) for point in geometry["points"]]
        if len(points) < 2:
            continue
        if stroke is not None and stroke_width > 0:
            draw.line(points, fill=stroke, width=max(1, round(stroke_width)), joint="curve")
            cap_radius = stroke_width / 2
            for point in points:
                draw.ellipse(
                    [point[0] - cap_radius, point[1] - cap_radius, point[0] + cap_radius, point[1] + cap_radius],
                    fill=stroke,
                )
        if fill is not None:
            draw.polygon(points, fill=fill)


def render_icon(
    view_width: float,
    view_height: float,
    shapes: list[Shape],
    size: int,
    *,
    full_bleed_background: bool = False,
    mark_scale: float = 1.0,
) -> Image.Image:
    """Растеризует знак в квадратный PNG заданного размера.

    full_bleed_background — фон во весь кадр без скругления (maskable и
    apple-touch-icon); mark_scale — масштаб знака внутри safe-zone.
    """
    canvas = size * SUPERSAMPLE
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # Базовый масштаб: viewBox → canvas (знак квадратный, поэтому один коэффициент).
    base = canvas / view_width
    offset_x = (canvas - view_width * base) / 2
    offset_y = (canvas - view_height * base) / 2

    background: Shape | None = None
    mark: list[Shape] = []
    for shape in shapes:
        if shape.kind == "rect" and _covers_viewbox(shape, view_width, view_height):
            background = shape
            continue
        mark.append(shape)

    if full_bleed_background:
        # Плитка во весь кадр: системная маска сама скрутит углы.
        color = (background.style["fill"] if background is not None else None) or BLACK
        draw.rectangle([0, 0, canvas, canvas], fill=color)
    elif background is not None:
        draw_shapes(draw, [background], base, (offset_x, offset_y))

    if mark_scale != 1.0:
        # Масштаб относительно центра знака: центр viewBox → центр canvas.
        center_x = view_width / 2
        center_y = view_height / 2
        scaled = base * mark_scale
        offset_x = (canvas - view_width * scaled) / 2
        offset_y = (canvas - view_height * scaled) / 2
        draw_shapes(draw, mark, scaled, (offset_x, offset_y))
    else:
        draw_shapes(draw, mark, base, (offset_x, offset_y))

    return image.resize((size, size), Image.LANCZOS)


def _covers_viewbox(shape: Shape, view_width: float, view_height: float) -> bool:
    """Плитка фона — прямоугольник во весь viewBox."""
    if shape.kind != "rect":
        return False
    geometry = shape.geometry
    return (
        math.isclose(geometry["x"], 0.0)
        and math.isclose(geometry["y"], 0.0)
        and math.isclose(geometry["w"], view_width)
        and math.isclose(geometry["h"], view_height)
    )


# ---------------------------------------------------------------------------
# Точка входа
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description="Генератор PNG-иконок знака «Цифровой деканат»")
    parser.add_argument("--svg", default="public/icon.svg", help="путь к исходному SVG")
    parser.add_argument("--out", default="public", help="каталог для PNG")
    args = parser.parse_args()

    svg_path = Path(args.svg)
    out_dir = Path(args.out)
    if not svg_path.is_file():
        print(f"не найден {svg_path}", file=sys.stderr)
        return 1
    out_dir.mkdir(parents=True, exist_ok=True)

    view_width, view_height, shapes = load_shapes(svg_path)

    targets: list[tuple[str, dict]] = [
        ("icon-192.png", {"size": 192}),
        ("icon-512.png", {"size": 512}),
        ("icon-maskable-512.png", {"size": 512, "full_bleed_background": True, "mark_scale": MASKABLE_SCALE}),
        ("apple-touch-icon-180.png", {"size": 180, "full_bleed_background": True, "mark_scale": APPLE_SCALE}),
    ]

    for name, options in targets:
        image = render_icon(view_width, view_height, shapes, **options)
        if options.get("full_bleed_background"):
            # Полнофонные иконки сохраняем без альфа-канала: маска ОС
            # (Android maskable, iOS apple-touch-icon) не должна получать
            # прозрачные края — иначе сквозь них виден фон системы.
            image = image.convert("RGB")
        destination = out_dir / name
        image.save(destination, "PNG", optimize=True)
        print(f"{destination}  {image.size[0]}×{image.size[1]}")

    print("Готово: иконки знака концепта перегенерированы из", svg_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
