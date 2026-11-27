# Designer card preview

The survey preview uses the five final lowercase v8 PDF artworks. Its screen assets are transparent WebP atlases at 1.5 pixels per PDF point, with separate fronts and backs. Photos sit under the artwork. The title circle, curved white Poppins Bold name, Poppins Regular answers, fitted text size, photo containment, and trim box match the tested blue print geometry. Sensitive photos and names remain in the browser and authenticated survey endpoints; only blank artwork and fonts are public assets.

Run `python scripts/build-card-preview-art.py /path/to/final-pdfs` to rebuild atlases. Filenames and original PDF SHA-256 hashes are recorded in `public/assets/card-preview/manifest.json`. Include the existing font files, their OFL license, and font-metrics.json with the assets. The metrics preserve the renderer’s text measurements without uploading the child’s name to another service.

The preview contains the title card and all 26 letter cards. Parents can switch between fronts and backs. Default photos, custom photos, incomplete entries and words that exceed the back panel are handled explicitly. Screen colors can differ from print colors.

Validation: all five colors and front/back controls reviewed in the browser; phone-width layout checked; all 130 letter photo-fit rectangles verified inside transparent artwork; text measurements, curved name glyph positions, and title-photo placement compared with the print functions in `test/card-preview.test.js`.

All five colors are connected to the final designer PDF exporter. See `docs/designer-print-colors.md` for template verification, output sizing and operational checks.
