# Default card photos

Drop one stock photo per letter here. These are the images shown in the yellow
"Use Default" box on the form **and** printed on the card when a customer leaves
a letter on its default.

## Naming

Name each file with the **uppercase letter** and an image extension:

```
A.png  B.png  C.png  ...  Z.png
```

The app looks for each letter in this order: `.png`, `.jpg`, `.jpeg`, `.webp`.

## Format notes

- **PNG or JPG is required for the printed PDF.** The PDF generator (`pdf-lib`)
  can only embed PNG and JPEG. WebP previews fine in the browser but will fail
  to print, so save the print defaults as PNG (transparent background is fine)
  or JPG.
- Aim for at least ~600 px on the short side so they stay crisp on the card.
- Square-ish images look best in the form's 56×56 thumbnail, but the card itself
  fits any aspect ratio without cropping.

Any letter without a file here automatically falls back to the lettered
placeholder tile, so it's fine to add them gradually.
