@echo off
set /p commit_msg=请输入commit原因: 
git add .
git commit -m "%commit_msg%"
git push origin master:main
echo 提交完成~
pause
