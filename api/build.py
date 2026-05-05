""" 
Copyright 2024 Amazon.com, Inc. and its affiliates. All Rights Reserved.

Licensed under the Amazon Software License (the "License").
You may not use this file except in compliance with the License.
A copy of the License is located at

  http://aws.amazon.com/asl/

or in the "license" file accompanying this file. This file is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
express or implied. See the License for the specific language governing
permissions and limitations under the License.
"""

import os
import subprocess
import sys


def exit_on_failure(exit_code, msg):
    if exit_code != 0:
        print(msg)
        exit(exit_code)


def build_lambda_functions():
    """Build all Lambda functions using consolidated package.json"""
    print("Installing dependencies...")
    
    # Install dependencies
    if os.path.exists("package.json"):
        proc = subprocess.run(["npm", "install"], stderr=subprocess.STDOUT)
        exit_on_failure(proc.returncode, "npm install failed")
        
        # Build TypeScript
        print("Building TypeScript...")
        proc = subprocess.run(["npm", "run", "build"], stderr=subprocess.STDOUT)
        exit_on_failure(proc.returncode, "TypeScript build failed")
    else:
        print("No package.json found, skipping build")


def main():
    print("Building API Lambda functions...")
    build_lambda_functions()
    print("API build completed successfully!")


if __name__ == "__main__":
    main()