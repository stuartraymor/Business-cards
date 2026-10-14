"""Entry point used by PyInstaller and for running from source: python run.py"""
import sys

from business_cards.__main__ import main

if __name__ == "__main__":
    sys.exit(main())
