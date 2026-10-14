"""Program entry point: python -m business_cards"""
from __future__ import annotations

import logging
import sys
import traceback

from PySide6.QtWidgets import QApplication, QMessageBox

from . import __version__
from .storage import CardStore, default_data_dir
from .ui_main import MainWindow


def _install_crash_log() -> None:
    log_path = default_data_dir() / "crash.log"
    logging.basicConfig(filename=log_path, level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")

    def hook(exc_type, exc, tb):
        text = "".join(traceback.format_exception(exc_type, exc, tb))
        logging.error("Unhandled error:\n%s", text)
        QMessageBox.critical(None, "Business Cards hit a problem",
                             f"Something went wrong. Details were saved to:\n{log_path}\n\n{exc}")

    sys.excepthook = hook


def main() -> int:
    default_data_dir().mkdir(parents=True, exist_ok=True)
    app = QApplication(sys.argv)
    app.setApplicationName("Business Cards")
    app.setApplicationVersion(__version__)
    app.setStyle("Fusion")
    _install_crash_log()
    store = CardStore()
    window = MainWindow(store)
    window.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
