"""Turns the frames of e2e/tour/flows.capture.ts into the README's GIFs (docs/images/flow-*.gif), each frame with a caption.

    pnpm build && pnpm --filter e2e tour      # on a freshly seeded demo database (see e2e/tour.config.ts)
    python scripts/frames-to-gif.py           # needs Pillow (pip install pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FRAMES = ROOT / "e2e" / "test-results" / "tour-frames"
OUT = ROOT / "docs" / "images"
WIDTH = 960
CAPTION_HEIGHT = 44

FLOWS = {
    "lead-appointment": [
        "A consultant opens a lead in Consulting",
        "Change status: only the moves allowed from here are offered",
        "Appointment booked, with the date and time",
        "The journey and the history show the appointment",
    ],
    "pt-booking": [
        "The PT calendar: one column per trainer",
        "Add booking: the customer, then their contract",
        "The trainer and the time; overlaps are refused",
        "The session is on the trainer's calendar",
    ],
}


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for name in ("arialbd.ttf", "DejaVuSans-Bold.ttf", "Arial Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def captioned(path: Path, caption: str, step: int, steps: int) -> Image.Image:
    shot = Image.open(path).convert("RGB")
    shot = shot.resize((WIDTH, round(shot.height * WIDTH / shot.width)), Image.LANCZOS)
    frame = Image.new("RGB", (WIDTH, shot.height + CAPTION_HEIGHT), (15, 23, 42))
    frame.paste(shot, (0, CAPTION_HEIGHT))
    draw = ImageDraw.Draw(frame)
    draw.text((16, CAPTION_HEIGHT / 2), f"{step}/{steps}  {caption}", font=font(18), fill=(255, 255, 255), anchor="lm")
    return frame


for flow, captions in FLOWS.items():
    paths = sorted((FRAMES / flow).glob("*.png"))
    if len(paths) != len(captions):
        raise SystemExit(f"{flow}: {len(paths)} frames for {len(captions)} captions; run the tour first")
    frames = [captioned(path, caption, index + 1, len(paths)) for index, (path, caption) in enumerate(zip(paths, captions))]
    palette = [frame.quantize(colors=256, method=Image.Quantize.MEDIANCUT) for frame in frames]
    durations = [2200] * (len(frames) - 1) + [4000]
    target = OUT / f"flow-{flow}.gif"
    palette[0].save(target, save_all=True, append_images=palette[1:], duration=durations, loop=0, optimize=True)
    print(f"{target.relative_to(ROOT)}: {target.stat().st_size // 1024} KB")
