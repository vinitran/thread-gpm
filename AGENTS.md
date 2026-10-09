# Quy tắc làm việc trong dự án

## Tự động đẩy code và phát hành

- Sau mỗi lần cập nhật tính năng, sửa lỗi hoặc chỉnh tài liệu, thực hiện kiểm tra phù hợp với thay đổi, rồi tự commit và push lên GitHub. Người dùng đã cho phép quy trình này; không hỏi lại xác nhận cho mỗi lần đẩy code.
- Repository chính là `git@github.com:vinitran/thread-gpm.git`. Nhánh phát hành là `main`. Không đẩy sang repository cũ `thread-tool`.
- Kiểm tra working tree trước khi commit; chỉ đưa vào commit những thay đổi thuộc công việc đang thực hiện. Không commit API key, thông tin đăng nhập, dữ liệu profile hoặc file build. Không ghi đè thay đổi của người dùng, không force-push.
- Push lên `main` sẽ kích hoạt `.github/workflows/build-desktop.yml`, tự chọn phiên bản chung, rồi gọi hai workflow riêng `build-macos.yml` và `build-windows.yml`. Mỗi nền tảng build xong sẽ phát hành ngay hoặc bổ sung file vào cùng GitHub Release, không chờ nền tảng kia. Dùng quy trình CI này, không tạo release hoặc tag trùng thủ công.
- Sau khi push thành công thì dừng công việc và báo đã đẩy code. Không chờ, theo dõi hoặc kiểm tra CI/GitHub Release sau khi push, trừ khi người dùng yêu cầu cụ thể.
- CI tự build và phát hành ở phía GitHub. Không coi push thành công là release thành công và không báo đã release khi chưa xác minh. Chỉ kiểm tra trạng thái CI, lỗi build hoặc các file release khi người dùng yêu cầu.
- Giữ CI chỉ build/phát hành, không thêm bước chạy test vào CI nếu người dùng chưa yêu cầu. Chạy kiểm tra phù hợp ở local; không chạy profile GPM thật hoặc đăng bình luận để kiểm thử khi chưa có yêu cầu mới.
- Nếu người dùng chỉ yêu cầu giải thích hoặc kiểm tra mà không có thay đổi file thì không tạo commit rỗng. Chỉ dẫn cụ thể mới hơn của người dùng (ví dụ không push hoặc không release) được ưu tiên.
