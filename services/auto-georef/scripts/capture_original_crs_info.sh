
# needs sshpass installed 
# apt-get update
# apt-get install sshpass

while read p; do
  echo "$p"
  sshpass -p password sftp de2824@de2824.rsync.net <<EOF
  get $p ./server_data/zip/
  exit
EOF
  dir_name=$(basename "$(dirname "$p")")
  bn=`basename ${p} .zip`
  new_dir="${bn}"
  mkdir -p "./server_data/zip/$new_dir"

  unzip ./server_data/zip/${bn}.zip -d ./server_data/zip/$new_dir &
  wait
  
  python3 process_geo_folder.py --folder "./server_data/zip/$new_dir" --map_name "$p" &
  wait

  rm -rf ./server_data/zip/${bn}.zip 
  rm -rf ./server_data/zip/$new_dir
  

done < server_data/geo1.txt