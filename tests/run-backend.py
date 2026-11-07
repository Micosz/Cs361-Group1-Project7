"""Run offline Auth tests from any working directory."""
import argparse
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'backend/lambda/CSTUHubAuth'
SUITE = ROOT / 'tests/backend/CSTUHubAuth'

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('-p', '--pattern', default='test_*.py')
    parser.add_argument('-v', '--verbose', action='store_true')
    args = parser.parse_args()
    sys.path.insert(0, str(SOURCE))
    sys.path.insert(0, str(SUITE))
    suite = unittest.defaultTestLoader.discover(str(SUITE), pattern=args.pattern)
    if suite.countTestCases() == 0:
        parser.error('No tests matched the requested pattern')
    result = unittest.TextTestRunner(verbosity=2 if args.verbose else 1).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
