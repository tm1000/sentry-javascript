# MAKE TEST APP USE THIS BRANCH
# CALL THIS WITH PATH-TO-TEST-APP AS THE FIRST/ONLY ARGUMENT

NEXTJS_SDK_DIR=$(pwd)
TEST_APP_DIR=$1
SDK_BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)

# make sure branch is already set up
echo " "
echo "Making sure branch is set up for vercel deployment."
yarn vercel:branch

cd $TEST_APP_DIR

# make sure we're dealing with a clean repo
STASHED_CHANGES=$(git status --porcelain)
if [ -n "${STASHED_CHANGES}" ]; then
  echo "Found uncommitted changes in your project. Stashing them."
  git stash --quiet --include-untracked
fi

# make sure we have a clean directory into which to put our scripts
echo " "
if [ -d .sentry ]; then
  echo "Clearing .sentry directory"
  rm -rf .sentry
else
  echo "Creating .sentry directory"
fi
mkdir .sentry

# set up scripts for use in vercel deployment
echo " "
echo "Creating install scripts and committing the changes"
cp $NEXTJS_SDK_DIR/vercel/install-sentry-from-branch.sh .sentry
echo "export BRANCH_NAME=${SDK_BRANCH_NAME}" >>.sentry/set-branch-name.sh
git add .
git commit -m "add scripts for using ${SDK_BRANCH_NAME} branch of @sentry/nextjs"

# restore working directory, if necessary
if [ -n "${STASHED_CHANGES}" ]; then
  echo " "
  echo "Restoring changes from earlier stash:"
  git stash pop --quiet
  git status --porcelain
  echo " "
fi

cd $NEXTJS_SDK_DIR

echo " "
echo "SUCCESS!"
echo "Your project will now use this branch of the SDK repo when deployed to Vercel. If you haven't done so already, go to your project settings and set a custom install command:"
echo "  yarn && source .sentry/install-sentry-from-branch.sh
"
