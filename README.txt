KOREAN VISUAL VOCABULARY — V1.6 FSRS + BÀN PHÍM HANGUL

CẬP NHẬT
1. Trong app cũ, nhấn Export và giữ file JSON trước khi cập nhật.
2. Giải nén ZIP. Upload toàn bộ các file bên trong lên thư mục gốc repo GitHub hiện tại, thay các file cùng tên.
3. Commit và chờ GitHub Pages triển khai. Mở lại đúng địa chỉ cũ, nhấn Ctrl+Shift+R.
4. Đóng/mở lại PWA nếu cần. Dòng tiêu đề phải có v1.6.
Không đổi tên cơ sở dữ liệu: từ vựng, ảnh và FSRS v1.3 vẫn được giữ khi dùng cùng địa chỉ/trình duyệt.
ZIP chứa mã ứng dụng, không chứa kho từ cá nhân trên thiết bị của bạn.


ÔN TẬP VỚI BÀN PHÍM HANGUL — V1.6
1. Chọn Review và Mode “Image → Korean”. Bàn phím Hàn sẽ hiện dưới ô trả lời.
2. Bấm phụ âm/nguyên âm; app tự ghép âm tiết, ví dụ ㅎ + ㅏ + ㄴ thành 한.
3. Shift dùng cho ㄲ, ㄸ, ㅃ, ㅆ, ㅉ, ㅒ, ㅖ và tự tắt sau một phím.
4. Có Xóa ký tự, Xóa hết, Khoảng trắng và Kiểm tra. Nút Thu gọn ghi nhớ lựa chọn trên thiết bị.
5. Bàn phím chỉ hỗ trợ nhập đáp án; cách chấm, Practice, FSRS và lịch sử ôn không thay đổi.
6. Bàn phím vật lý và bộ gõ tiếng Hàn của thiết bị vẫn dùng bình thường.


NHẬP HÀNG LOẠT — V1.6
1. Trong app, nhấn Nhập hàng loạt.
2. Nhấn Tải bảng mẫu CSV. Thay các dòng ví dụ bằng từ của bạn.
3. Cột bắt buộc: korean, meaning. Cột tùy chọn: image, tags, example, pronunciation, pos, notes, acceptedKorean, acceptedMeaning.
4. Chọn CSV UTF-8/TSV, hoặc copy các ô trong Excel và dán vào ô nhập. App không đọc trực tiếp .xlsx.
5. Nhấn Xem trước bảng nếu vừa dán/chỉnh nội dung.
6. Chọn nhiều ảnh cùng lúc (Ctrl/Shift khi chọn file). Tên trong cột image cần khớp tên file, ví dụ apple.jpg. Nếu không điền image, app thử tên từ tiếng Hàn, ví dụ 사과.png.
7. Xem ảnh từng dòng. Bạn có thể chọn ảnh riêng hoặc kéo file ảnh từ máy vào ô ảnh của dòng.
8. Kiểm tra dòng lỗi, từ trùng và ảnh thiếu. Bỏ chọn dòng không muốn nhập.
9. Mặc định bỏ qua từ đã có. Nếu chọn cập nhật: thay nghĩa/nội dung được điền, giữ ID, ngày tạo, FSRS và lịch sử; ô tùy chọn trống giữ nội dung cũ; thiếu ảnh giữ ảnh cũ.
10. Nhấn Nhập ... từ đã chọn để lưu. Tất cả từ được ghi trong một giao dịch; nếu lỗi trước/trong giao dịch thì không nhập dở dang.

QUY TẮC
- Dấu phân cách tự nhận diện: tab, dấu phẩy hoặc chấm phẩy; có thể chọn tay.
- Không có tiêu đề: các cột theo thứ tự Hàn, nghĩa, ảnh, tags, ví dụ, phiên âm, từ loại, ghi chú.
- tags: ngăn cách bằng dấu phẩy, chấm phẩy hoặc |. Đáp án thay thế: mỗi dòng một đáp án hoặc ngăn cách bằng |.
- CSV có dấu phẩy/xuống dòng trong ô phải có ngoặc kép đúng chuẩn. Excel xuất CSV UTF-8 sẽ xử lý phần này.
- Từ trùng được nhận diện bằng tiếng Hàn sau chuẩn hóa Unicode, chữ hoa/thường và khoảng trắng; không đoán từ đồng nghĩa/biến thể ngữ pháp.
- Trùng trong bảng: chỉ xử lý dòng hợp lệ được chọn đầu tiên. Nếu kho có nhiều bản cùng từ, app không tự chọn một bản để cập nhật.
- Thiếu ảnh vẫn nhập được. Nhiều ảnh khớp cùng tên thì cần chọn thủ công.
- Mỗi lần tối đa 1.000 dòng, bảng 5 MB, mỗi ảnh xử lý tối đa 20 MB. Ảnh được nén theo cơ chế hiện có của app (cạnh dài tối đa 1500px, JPEG).
- Nếu chọn file ảnh hỏng/không đọc được, app dừng trước khi lưu; chọn ảnh khác hoặc xóa ảnh đã chọn rồi thử lại.
- Thoát buổi ôn trước khi nhập hàng loạt. Các từ mới bắt đầu trạng thái New.
- File ZIP/bảng mẫu không chứa ảnh minh họa; bạn chọn ảnh của mình. Không cần dịch vụ ảnh hay tài khoản ngoài.

CÁC CẢI THIỆN TỪ V1.4
- Hàng đợi Daily/Due tự cập nhật sau mỗi lần đánh giá. Thẻ Learning/Relearning đến hạn tự quay lại.
- Khi chưa đến hạn, màn hình hiển thị thời gian chờ; không ép ôn sớm. Có thể thoát vì lịch đã lưu.
- Màn hình hoàn thành riêng: thoát và bắt đầu lại không cần tải lại trang.
- More details có hai ô đáp án thay thế (tiếng Hàn/nghĩa Việt): mỗi dòng một đáp án.
  So khớp chuẩn hóa Unicode, chữ hoa/thường và khoảng trắng. Không tự đoán từ đồng nghĩa.
- Khóa nút khi đang lưu đánh giá; Hoàn tác khôi phục từ và lịch sử trước lần đánh giá gần nhất trong buổi.
- Tách từ mới, lượt Review và lượt Learning/Relearning. Giới hạn Review chỉ tính các lượt có trạng thái trước trả lời là Review; học lại không giới hạn. Giới hạn từ mới tính theo ID duy nhất mỗi ngày.
- Hiển thị lần xuất JSON gần nhất, nhắc sau 7 ngày. Đây là thời điểm yêu cầu tải xuống, không xác nhận file đã được người dùng cất giữ.
- Kiểm tra cấu trúc JSON trước khi nhập; dữ liệu từ được ghi trong một giao dịch để tránh nhập dở dang.
- Phóng to ảnh trong màn hình sửa từ và khi ôn; đóng bằng nút Đóng hoặc Escape.
- Practice không thay đổi lịch hoặc lịch sử ôn.

LƯU TRỮ VÀ TƯƠNG THÍCH
Dữ liệu vẫn lưu bằng IndexedDB tại trình duyệt, không đồng bộ đám mây.
Xuất JSON định kỳ; bản sao lưu chứa ảnh, đáp án thay thế, trạng thái FSRS và lịch sử.
File v1.3 được hỗ trợ. Thẻ cũ v1/v1.2 không có fsrsCard vẫn bắt đầu NEW; trường srs cũ được giữ nhưng không sử dụng.
Ảnh nhập JSON chấp nhận dữ liệu base64 JPEG, PNG, WebP, GIF; app tự tạo ảnh JPEG khi tải lên.
FSRS vẫn là ts-fsrs 5.4.1 qua jsDelivr. Cần tải online thành công và cache thư viện trước khi sử dụng offline.
Mục tiêu ghi nhớ mặc định 90%; bước học 1m/10m, học lại 10m.
